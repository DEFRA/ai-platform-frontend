import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  cookieHeader,
  mergeCookies,
  signInViaOidc
} from '#/test-helpers/oidc-session-helpers.js'

vi.mock('#/server/common/helpers/oidc-client.js', () => ({
  getOidcConfig: vi.fn().mockResolvedValue('fake-oidc-config')
}))

vi.mock('openid-client', () => ({
  randomPKCECodeVerifier: vi.fn(() => 'verifier'),
  calculatePKCECodeChallenge: vi.fn(async () => 'challenge'),
  randomState: vi.fn(() => 'state-123'),
  randomNonce: vi.fn(() => 'nonce-123'),
  buildAuthorizationUrl: vi.fn(
    () =>
      new URL(
        'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=state-123'
      )
  ),
  authorizationCodeGrant: vi.fn(async () => ({
    access_token: 'user-access-token',
    refresh_token: 'user-refresh-token',
    expires_in: 3600,
    claims: () => ({
      preferred_username: 'test.user@defra.gov.uk',
      email: 'test.user@defra.gov.uk',
      name: 'Test User'
    })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const DETAIL = '/v1/admin/team-deployments/team-1/infradev'
const PAGE = '/admin/deployments/team-1/infradev'

function answer(status, code) {
  return reply(status, { statusCode: status, code, message: 'Refused' })
}

const FORBIDDEN = answer(403, 'platform-admin-required')

function model(overrides = {}) {
  return {
    id: 'op-1',
    modelSlug: 'gpt-4o',
    modelName: 'GPT-4o',
    status: 'active',
    detail: 'Ready to use',
    updatedAt: '2026-10-30T14:05:00.000Z',
    retryable: false,
    ...overrides
  }
}

function detail(overrides = {}) {
  return {
    team: {
      id: 'team-1',
      name: 'Flood Risk Team',
      status: 'active',
      memberCount: 3
    },
    environment: 'infradev',
    status: 'needs-attention',
    credential: { status: 'active' },
    deployments: [
      model(),
      model({
        id: 'op-2',
        modelSlug: 'claude',
        modelName: 'Claude',
        status: 'deploy-failed',
        detail: 'The deployment failed',
        updatedAt: '2026-10-30T15:00:00.000Z',
        retryable: true
      }),
      model({
        id: 'op-3',
        modelSlug: 'llama',
        modelName: 'Llama',
        status: 'checks-failed',
        detail: 'The checks failed'
      })
    ],
    environments: [
      { environment: 'infradev', credential: { status: 'active' } },
      { environment: 'qa', credential: { status: 'disabled' } }
    ],
    ...overrides
  }
}

describe('#admin deployment detail', () => {
  let server
  let cookies

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    fetchMock.resetMocks()
    cookies = await signInViaOidc(server, fetchMock, { isPlatformAdmin: true })
  })

  function get(url, jar = cookies) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(jar) }
    })
  }

  function post(url, payload = {}, jar = cookies) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(jar) },
      payload: { crumb: jar.crumb, ...payload }
    })
  }

  function follow(response) {
    return get(
      response.headers.location,
      mergeCookies({ ...cookies }, response)
    )
  }

  function writes() {
    return fetchMock
      .requests()
      .filter(
        (request) =>
          new URL(request.url).pathname.startsWith('/v1/admin') &&
          request.method !== 'GET'
      )
      .map((request) => `${request.method} ${new URL(request.url).pathname}`)
  }

  test('redirects a signed out person to sign in, and asks the backend nothing', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: PAGE
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toContain('/sign-in')
  })

  describe('the page', () => {
    test('names the team as the heading with the worst state as a tag, the environment as caption and in the breadcrumb', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await get(PAGE)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('title').text()).toContain(
        'Flood Risk Team in Development - Admin'
      )
      expect($('h1').text()).toBe('Flood Risk Team')
      expect($('[data-testid="app-heading-caption"]').text()).toBe(
        'Development'
      )
      expect($('[data-testid="deployment-status"]').text().trim()).toBe(
        'Needs attention'
      )
      expect($('[data-testid="deployment-status"]').attr('class')).toContain(
        'govuk-tag--red'
      )
      expect(
        $('.govuk-breadcrumbs__list-item')
          .map((_, item) => $(item).text().trim())
          .get()
      ).toEqual([
        'Home',
        'Admin',
        'Deployments',
        'Development',
        'Flood Risk Team'
      ])
      expect(
        $('.govuk-breadcrumbs__link')
          .map((_, link) => $(link).attr('href'))
          .get()
      ).toEqual([
        '/',
        '/admin/teams',
        '/admin/deployments',
        '/admin/deployments?environment=infradev'
      ])
      expect($('[aria-label="Admin"] [aria-current="page"]').text()).toBe(
        'Deployments'
      )
    })

    test('has a summary: the credential state only, the members with a link to the team, and a link to its activity', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const $ = load((await get(PAGE)).result)
      const summary = $('[data-testid="deployment-summary"]')
      const rows = summary
        .find('.govuk-summary-list__row')
        .map((_, row) => [
          [
            $(row).find('dt').text().trim(),
            $(row).find('dd').text().replace(/\s+/g, ' ').trim()
          ]
        ])
        .get()

      expect(rows).toEqual([
        ['Credential', 'Active'],
        ['Members', '3 members View team'],
        ['Team status', 'Active']
      ])
      expect($('[data-testid="view-team"]').attr('href')).toBe(
        '/admin/teams/team-1'
      )
      expect($('[data-testid="view-activity"]').attr('href')).toBe(
        '/admin/audit?team=team-1&environment=infradev'
      )
    })

    test('says when a credential is disabled, and when', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail({
          credential: {
            status: 'disabled',
            blockedAt: '2026-10-30T14:05:00.000Z'
          }
        })
      })

      const $ = load((await get(PAGE)).result)
      const credential = $('[data-testid="deployment-summary"] dd')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim()

      expect(credential).toBe('Disabled Disabled on 30 October 2026, 2:05pm')
    })

    test('shows each model’s health in a table in a focusable scroll region, with a hidden caption', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const $ = load((await get(PAGE)).result)
      const rows = $('[data-testid="model-row"]')

      expect($('.app-table-scroll').attr('role')).toBe('region')
      expect($('.app-table-scroll').attr('tabindex')).toBe('0')
      expect($('caption').text()).toBe('Deployment health in Development')
      expect($('caption').attr('class')).toContain('govuk-visually-hidden')
      expect(
        $('[data-testid="health-table"] th')
          .map((_, header) => $(header).text().trim())
          .get()
      ).toEqual(['Model', 'Status', 'Detail', 'Updated', 'Actions'])
      expect(rows).toHaveLength(3)
      expect(
        rows
          .eq(0)
          .find('td')
          .slice(0, 4)
          .map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
          .get()
      ).toEqual([
        'GPT-4o',
        'Ready to use',
        'Ready to use',
        '30 October 2026, 2:05pm'
      ])
      expect(rows.eq(1).find('.govuk-tag').attr('class')).toContain(
        'govuk-tag--red'
      )
      expect(rows.eq(1).find('.govuk-tag').text().trim()).toBe('Setup failed')
    })

    test('has Reconcile for every model and Retry only where the backend says it is retryable, as POST buttons with the crumb and the model named for a screen reader', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const $ = load((await get(PAGE)).result)
      const forms = $('[data-testid="model-row"] form')
      const actions = forms
        .map(
          (_, form) =>
            `${$(form).attr('method')} ${$(form).attr('action')} ${$(form).find('button').text().replace(/\s+/g, ' ').trim()}`
        )
        .get()

      expect(actions).toEqual([
        'post /admin/deployments/team-1/infradev/models/op-1/reconcile Reconcile GPT-4o',
        'post /admin/deployments/team-1/infradev/models/op-2/reconcile Reconcile Claude',
        'post /admin/deployments/team-1/infradev/models/op-2/retry Retry Claude',
        'post /admin/deployments/team-1/infradev/models/op-3/reconcile Reconcile Llama'
      ])
      expect(forms.find('input[name="crumb"]')).toHaveLength(4)
      expect(
        $('[data-testid="model-row"] .govuk-visually-hidden')
          .map((_, hidden) => $(hidden).text())
          .get()
      ).toEqual([' GPT-4o', ' Claude', ' Claude', ' Llama'])
    })

    test('says a model whose checks failed needs a new request, since Retry is not offered', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const $ = load((await get(PAGE)).result)

      expect(
        $('[data-testid="model-row"]').eq(2).find('td').last().text()
      ).toContain('The team must request this model again')
      expect(
        $('[data-testid="model-row"]').eq(1).find('td').last().text()
      ).not.toContain('request this model again')
    })

    test('says there are no models when the team has none in the environment', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail({ deployments: [], status: 'ready' })
      })

      const $ = load((await get(PAGE)).result)

      expect($('table')).toHaveLength(0)
      expect($('[data-testid="no-models"]').text()).toContain(
        'no models in Development'
      )
    })

    test.each([
      ['active', ['Disable credentials', 'Revoke credentials']],
      ['revoked', ['Disable credentials']],
      ['none', ['Disable credentials']]
    ])(
      'offers the credential actions that make sense for %s: %j',
      async (status, expected) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail({ credential: { status } })
        })

        const $ = load((await get(PAGE)).result)

        expect(
          $('[data-testid="credential-actions"] .govuk-button')
            .map((_, button) => $(button).text().trim())
            .get()
        ).toEqual(expected)
      }
    )

    test.each([
      ['active', ['Enable credentials', 'Revoke credentials']],
      ['revoked', ['Enable credentials']],
      ['none', ['Enable credentials']]
    ])(
      'offers a disabled environment holding %s: %j (P1-AC11)',
      async (held, expected) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail({
            credential: { status: 'disabled', held }
          })
        })

        const $ = load((await get(PAGE)).result)

        expect(
          $('[data-testid="credential-actions"] .govuk-button')
            .map((_, button) => $(button).text().trim())
            .get()
        ).toEqual(expected)
      }
    )

    test.each([
      ['revoked', 'Credential under the block: Revoked'],
      ['active', 'Credential under the block: Active'],
      ['none', 'Credential under the block: None']
    ])(
      'says what is under a block, so a revoked credential in a disabled environment shows Revoked (P1-AC10): %s',
      async (held, line) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail({
            credential: {
              status: 'disabled',
              held,
              blockedAt: '2026-10-30T14:05:00.000Z'
            }
          })
        })

        const $ = load((await get(PAGE)).result)
        const credential = $('[data-testid="deployment-summary"] dd')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim()

        expect(credential).toBe(
          `Disabled Disabled on 30 October 2026, 2:05pm ${line}`
        )
      }
    )

    test('says nothing is under a block when the credential is not blocked', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail({ credential: { status: 'revoked' } })
      })

      const $ = load((await get(PAGE)).result)

      expect($('[data-testid="credential-under-block"]')).toHaveLength(0)
    })

    test('links each credential action to its page, Disable secondary, Enable green and Revoke red', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail({
          credential: { status: 'disabled', held: 'active' }
        })
      })

      const $ = load((await get(PAGE)).result)
      const enable = $('[data-testid="enable-credentials"]')
      const revoke = $('[data-testid="revoke-credentials"]')

      expect(enable.attr('href')).toBe(`${PAGE}/credentials/enable`)
      expect(enable.attr('class')).not.toContain('govuk-button--secondary')
      expect(revoke.attr('href')).toBe(`${PAGE}/credentials/revoke`)
      expect(revoke.attr('class')).toContain('govuk-button--warning')

      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const again = load((await get(PAGE)).result)

      expect(
        again('[data-testid="disable-credentials"]').attr('class')
      ).toContain('govuk-button--secondary')
      expect(again('[data-testid="disable-credentials"]').attr('href')).toBe(
        `${PAGE}/credentials/disable`
      )
    })

    test('links to the team’s deployment in each environment, with its credential state, the current one not a link', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const $ = load((await get(PAGE)).result)
      const items = $('[data-testid="team-environments"] li')

      expect(
        items.map((_, item) => $(item).text().replace(/\s+/g, ' ').trim()).get()
      ).toEqual(['Development (this page): Active', 'Test: Disabled'])
      expect(items.eq(0).find('a')).toHaveLength(0)
      expect(items.eq(1).find('a').attr('href')).toBe(
        '/admin/deployments/team-1/qa'
      )
    })

    test('escapes what the backend gave, and shows no secret, key hint or external id', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail({
          team: {
            id: 'team-1',
            name: '<b>Team</b>',
            status: 'active',
            memberCount: 1
          },
          deployments: [model({ detail: '<script>x</script>' })],
          credential: {
            status: 'active',
            keyHint: 'abcd',
            externalId: 'ext-123',
            secret: 'shh'
          }
        })
      })

      const { result } = await get(PAGE)

      expect(result).not.toContain('<b>Team</b>')
      expect(result).not.toContain('<script>x</script>')
      expect(result).not.toContain('abcd')
      expect(result).not.toContain('ext-123')
      expect(result).not.toContain('shh')
    })

    test('shows the success notification that a change left, once', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/team-deployments/op-1/reconcile': reply(202, {
          deployment: {}
        })
      })

      const response = await post(`${PAGE}/models/op-1/reconcile`)
      const jar = mergeCookies({ ...cookies }, response)
      const first = load((await get(PAGE, jar)).result)

      expect(first('[data-testid="team-notification"]').text()).toContain(
        'Reconcile requested for GPT-4o'
      )
    })
  })

  describe('what the backend refuses or cannot do', () => {
    test('shows the 403 page with the same title as its heading', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: FORBIDDEN })

      const { statusCode, result } = await get(PAGE)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect($('h1').text()).toBe('Only a Platform Admin can use this page')
      expect($('title').text()).toContain(
        'Only a Platform Admin can use this page'
      )
    })

    test('shows the 404 page for a team or environment with no deployment', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: answer(404, 'deployment-not-found')
      })

      const { statusCode, result } = await get(PAGE)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.notFound)
      expect($('h1').text()).toBe('Deployment not found')
      expect($('title').text()).toContain('Deployment not found')
      expect($('main .govuk-button').attr('href')).toBe('/admin/deployments')
    })

    test('shows the service unavailable page for a failing backend', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: answer(502, 'upstream-unavailable')
      })

      const { statusCode, result } = await get(PAGE)

      expect(statusCode).toBe(statusCodes.badGateway)
      expect(load(result)('h1').text()).toBe('We could not load this page')
    })

    test('asks the backend for the team and environment as given, escaped', async () => {
      mockApi(fetchMock, {})

      await get('/admin/deployments/team%201/in%20fra')

      expect(
        fetchMock.mock.calls.map(([url]) => new URL(url).pathname)
      ).toContain('/v1/admin/team-deployments/team%201/in%20fra')
    })
  })

  describe('Reconcile and Retry', () => {
    const RECONCILE = `${PAGE}/models/op-1/reconcile`
    const RETRY = `${PAGE}/models/op-2/retry`

    test('Reconcile runs the built route for the model, then returns to the page with a notification', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/team-deployments/op-1/reconcile': reply(202, {
          deployment: {}
        })
      })

      const response = await post(RECONCILE)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)
      expect(writes()).toEqual([
        'POST /v1/admin/team-deployments/op-1/reconcile'
      ])
    })

    test('Retry runs the built route for a retryable model and says so', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/team-deployments/op-2/retry': reply(202, {
          deployment: {}
        })
      })

      const response = await post(RETRY)
      const page = load((await follow(response)).result)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(writes()).toEqual(['POST /v1/admin/team-deployments/op-2/retry'])
      expect(page('[data-testid="team-notification"]').text()).toContain(
        'Retry requested for Claude'
      )
    })

    test('does not run a model that is not on the page, whatever the address says', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await post(
        `${PAGE}/models/op-99/reconcile`
      )

      expect(statusCode).toBe(statusCodes.notFound)
      expect(load(result)('h1').text()).toBe('Deployment not found')
      expect(writes()).toEqual([])
    })

    test('says why when the backend refuses a Retry, on the page, with an error summary that links to the table', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/team-deployments/op-2/retry': answer(
          409,
          'deployment-not-retryable'
        )
      })

      const { statusCode, result } = await post(RETRY)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.conflict)
      expect($('title').text()).toContain(
        'Error: Flood Risk Team in Development'
      )
      expect($('.govuk-error-summary__title').text().trim()).toBe(
        'There is a problem'
      )
      expect($('.govuk-error-summary a').text()).toBe(
        'Claude cannot be retried in its current state. A model whose checks failed needs a new request from the team'
      )
      expect($($('.govuk-error-summary a').attr('href'))).toHaveLength(1)
      expect($('h1').text()).toBe('Flood Risk Team')
    })

    test('says a Reconcile the backend refuses could not be done, in its current state, with the generic words', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/team-deployments/op-1/reconcile': answer(
          409,
          'deployment-busy'
        )
      })

      const { statusCode, result } = await post(RECONCILE)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.conflict)
      expect($('.govuk-error-summary a').text()).toBe(
        'Reconcile could not be done for GPT-4o in its current state. Check the table and try again'
      )
      expect(writes()).toEqual([
        'POST /v1/admin/team-deployments/op-1/reconcile'
      ])
    })

    test('shows the error page when the dispatch fails', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/team-deployments/op-1/reconcile': answer(
          502,
          'upstream-unavailable'
        )
      })

      const { statusCode, result } = await post(RECONCILE)

      expect(statusCode).toBe(statusCodes.badGateway)
      expect(load(result)('h1').text()).toBe('We could not load this page')
    })

    test('shows the 403 page for a person who is not a Platform Admin', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: FORBIDDEN })

      const { statusCode } = await post(RECONCILE)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(writes()).toEqual([])
    })

    test('refuses a post with no crumb', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode } = await server.inject({
        method: 'POST',
        url: RECONCILE,
        headers: { cookie: cookieHeader(cookies) },
        payload: {}
      })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(writes()).toEqual([])
    })
  })
})

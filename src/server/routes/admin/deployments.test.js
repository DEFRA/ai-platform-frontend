import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  cookieHeader,
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

const LIST = '/v1/admin/team-deployments'

const FORBIDDEN = reply(403, {
  statusCode: 403,
  error: 'Forbidden',
  message: 'Forbidden',
  code: 'platform-admin-required'
})

const OPTIONS = {
  environments: ['infradev', 'prod'],
  models: [
    { slug: 'gpt-4o', name: 'GPT-4o' },
    { slug: 'claude', name: 'Claude' }
  ]
}

function row(overrides = {}) {
  return {
    teamId: 'team-1',
    teamName: 'Flood Risk Team',
    environment: 'infradev',
    models: [
      { slug: 'gpt-4o', name: 'GPT-4o' },
      { slug: 'claude', name: 'Claude' }
    ],
    status: 'ready',
    credential: 'active',
    lastChangedAt: '2026-10-30T14:05:00.000Z',
    ...overrides
  }
}

function listing(deployments = [row()], overrides = {}) {
  return {
    deployments,
    page: 1,
    pageSize: 25,
    total: deployments.length,
    environment: 'infradev',
    options: OPTIONS,
    ...overrides
  }
}

describe('#admin deployments list', () => {
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

  function adminCalls() {
    return fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter(({ pathname }) => pathname.startsWith('/v1/admin'))
      .map(({ pathname, search }) => `${pathname}${search}`)
  }

  function cells(tableRow, $) {
    return $(tableRow)
      .find('td')
      .map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
      .get()
  }

  test('redirects a signed out person to sign in, and asks the backend nothing', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/admin/deployments'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toContain('/sign-in')
    expect(adminCalls()).toEqual([])
  })

  describe('the page', () => {
    test('is the Deployments tab of the Admin area, with the current tab marked and its own title', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

      const { statusCode, result } = await get('/admin/deployments')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(adminCalls()).toEqual([LIST])
      expect($('title').text()).toContain('Deployments - Admin')
      expect($('title').text()).not.toContain('Error:')
      expect($('h1').text()).toBe('Deployments')
      expect($('[data-testid="app-heading-caption"]').text()).toBe('Admin')
      expect(
        $('[aria-label="Admin"] a')
          .map((_, link) => `${$(link).text().trim()} ${$(link).attr('href')}`)
          .get()
      ).toEqual([
        'Teams /admin/teams',
        'Deployments /admin/deployments',
        'Audit log /admin/audit'
      ])
      expect($('[aria-label="Admin"] [aria-current="page"]').text()).toBe(
        'Deployments'
      )
      expect(
        $('.govuk-breadcrumbs__list-item')
          .map((_, item) => $(item).text().trim())
          .get()
      ).toEqual(['Home', 'Admin', 'Deployments'])
    })

    test('has a link for each environment the backend lists, the one shown marked current', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

      const $ = load((await get('/admin/deployments')).result)
      const nav = $('[aria-label="Environment"]')

      expect(
        nav
          .find('a')
          .map((_, link) => `${$(link).text().trim()} ${$(link).attr('href')}`)
          .get()
      ).toEqual([
        'Development /admin/deployments?environment=infradev',
        'Production /admin/deployments?environment=prod'
      ])
      expect(nav.find('[aria-current="page"]').text()).toBe('Development')
    })

    test('asks for the environment given', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}?environment=prod`]: listing([row()], {
          environment: 'prod'
        })
      })

      const $ = load((await get('/admin/deployments?environment=prod')).result)

      expect(adminCalls()).toEqual([`${LIST}?environment=prod`])
      expect($('[aria-label="Environment"] [aria-current="page"]').text()).toBe(
        'Production'
      )
    })

    test('lists a team a row: team link to its deployment, models, status, credential and last change', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}`]: listing(
          [
            row(),
            row({
              teamId: 'team 2',
              teamName: 'Air Quality Team',
              models: [],
              status: 'needs-attention',
              credential: 'disabled',
              lastChangedAt: '2026-07-15T13:05:00.000Z'
            })
          ],
          { total: 2 }
        )
      })

      const $ = load((await get('/admin/deployments')).result)
      const rows = $('[data-testid="deployment-row"]')

      expect(rows).toHaveLength(2)
      expect(cells(rows[0], $)).toEqual([
        'Flood Risk Team',
        'GPT-4o, Claude',
        'Ready',
        'Active',
        '30 October 2026, 2:05pm'
      ])
      expect(cells(rows[1], $)).toEqual([
        'Air Quality Team',
        'None',
        'Needs attention',
        'Disabled',
        '15 July 2026, 2:05pm'
      ])
      expect(rows.eq(0).find('a').attr('href')).toBe(
        '/admin/deployments/team-1/infradev'
      )
      expect(rows.eq(1).find('a').attr('href')).toBe(
        '/admin/deployments/team%202/infradev'
      )
      expect(rows.eq(0).find('time').attr('datetime')).toBe(
        '2026-10-30T14:05:00.000Z'
      )
      expect(rows.eq(1).find('.govuk-tag').first().attr('class')).toContain(
        'govuk-tag--red'
      )
      expect($('[data-testid="deployments-count"]').text()).toBe(
        'Showing 1 to 2 of 2 deployments in Development'
      )
    })

    test('says "deployment" for one', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

      const $ = load((await get('/admin/deployments')).result)

      expect($('[data-testid="deployments-count"]').text()).toBe(
        'Showing 1 to 1 of 1 deployment in Development'
      )
    })

    test('has a hidden caption, column headers and a table in a focusable scroll region', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

      const $ = load((await get('/admin/deployments')).result)

      expect($('caption').text()).toBe('Deployments in Development')
      expect($('caption').attr('class')).toContain('govuk-visually-hidden')
      expect($('.app-table-scroll').attr('role')).toBe('region')
      expect($('.app-table-scroll').attr('tabindex')).toBe('0')
      expect($('.app-table-scroll').attr('aria-label')).toBe(
        'Deployments in Development'
      )
      expect(
        $('th')
          .map((_, header) => $(header).text().trim())
          .get()
      ).toEqual(['Team', 'Models', 'Status', 'Credential', 'Last change'])
    })

    test('escapes a team name and model name', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}`]: listing([
          row({
            teamName: '<b>Team</b>',
            models: [{ slug: 'x', name: '<i>M</i>' }]
          })
        ])
      })

      const { result } = await get('/admin/deployments')

      expect(result).not.toContain('<b>Team</b>')
      expect(result).not.toContain('<i>M</i>')
    })

    test('numbers the rows of a later page from where it starts, and links pages with the filters kept', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}?environment=infradev&search=flood&page=2`]: listing(
          [row()],
          { page: 2, total: 51 }
        )
      })

      const $ = load(
        (
          await get(
            '/admin/deployments?environment=infradev&search=flood&page=2'
          )
        ).result
      )

      expect($('[data-testid="deployments-count"]').text()).toBe(
        'Showing 26 to 26 of 51 deployments in Development'
      )
      expect(
        $('.govuk-pagination__link')
          .map((_, link) => $(link).attr('href'))
          .get()
      ).toEqual([
        '/admin/deployments?environment=infradev&search=flood',
        '/admin/deployments?environment=infradev&search=flood',
        '/admin/deployments?environment=infradev&search=flood&page=2',
        '/admin/deployments?environment=infradev&search=flood&page=3',
        '/admin/deployments?environment=infradev&search=flood&page=3'
      ])
    })

    test('shows no pagination for one page', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

      const $ = load((await get('/admin/deployments')).result)

      expect($('.govuk-pagination')).toHaveLength(0)
    })

    test('says there are no deployments in the environment yet, when none are filtered', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing([], { total: 0 }) })

      const $ = load((await get('/admin/deployments')).result)

      expect($('[data-testid="deployments-empty"]').text()).toContain(
        'There are no deployments in Development yet'
      )
      expect($('table')).toHaveLength(0)
    })

    test('says "No deployments match", with Clear filters that keeps the environment, when a filter finds none', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}?environment=infradev&search=zzz`]: listing([], {
          total: 0
        })
      })

      const $ = load(
        (await get('/admin/deployments?environment=infradev&search=zzz')).result
      )

      expect($('[data-testid="deployments-empty"]').text()).toContain(
        'No deployments match'
      )
      expect($('[data-testid="deployments-empty"] a').attr('href')).toBe(
        '/admin/deployments?environment=infradev'
      )
      expect($('[data-testid="deployments-clear"]').attr('href')).toBe(
        '/admin/deployments?environment=infradev'
      )
    })

    test('says where the pages are when the page asked for is past the last', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}?page=9`]: listing([], { page: 9, total: 51 })
      })

      const $ = load((await get('/admin/deployments?page=9')).result)
      const past = $('[data-testid="deployments-past-end"]')

      expect(past.text()).toContain('There is no page 9')
      expect(past.text()).toContain('There are 51 deployments on 3 pages.')
      expect(
        past
          .find('a')
          .map((_, link) => `${$(link).text()} ${$(link).attr('href')}`)
          .get()
      ).toEqual([
        'Go to page 1 /admin/deployments?environment=infradev',
        'Go to page 3 (the last page) /admin/deployments?environment=infradev&page=3'
      ])
      expect($('table')).toHaveLength(0)
    })
  })

  describe('the filters', () => {
    test('is a GET form that works without script, with the environment kept, and the choices filled in as asked', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}?environment=infradev&search=flood&model=claude&status=needs-attention&credential=revoked`]:
          listing()
      })

      const $ = load(
        (
          await get(
            '/admin/deployments?environment=infradev&search=flood&model=claude&status=needs-attention&credential=revoked'
          )
        ).result
      )
      const form = $('form[method="get"]')

      expect(form.attr('action')).toBe('/admin/deployments')
      expect(form.find('input[name="environment"]').attr('type')).toBe('hidden')
      expect(form.find('input[name="environment"]').val()).toBe('infradev')
      expect(form.find('#search').val()).toBe('flood')
      expect(form.find('#model').val()).toBe('claude')
      expect(form.find('#status').val()).toBe('needs-attention')
      expect(form.find('#credential').val()).toBe('revoked')
      expect(
        form
          .find('label')
          .map((_, label) => $(label).text().trim())
          .get()
      ).toEqual(['Team name', 'Model', 'Status', 'Credential'])
      expect(
        form
          .find('#model option')
          .map((_, option) => $(option).text())
          .get()
      ).toEqual(['All models', 'GPT-4o', 'Claude'])
      expect($('form[method="get"] input[name="crumb"]')).toHaveLength(0)
      expect($('[data-testid="deployments-clear"]').attr('href')).toBe(
        '/admin/deployments?environment=infradev'
      )
    })

    test('has no Clear filters link when nothing is filtered', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

      const $ = load((await get('/admin/deployments')).result)

      expect($('[data-testid="deployments-clear"]')).toHaveLength(0)
    })

    test('still shows a model that is asked for but not on the list', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}?model=old-model`]: listing([], { total: 0 })
      })

      const $ = load((await get('/admin/deployments?model=old-model')).result)

      expect($('#model').val()).toBe('old-model')
    })
  })

  describe('a query the page can tell is wrong', () => {
    test.each([
      ['search', 'a', 'Search must be 2 to 100 characters', '#search'],
      ['status', 'broken', 'Choose a status from the list', '#status'],
      [
        'credential',
        'broken',
        'Choose a credential from the list',
        '#credential'
      ],
      [
        'page',
        '0',
        'The page number must be a whole number, 1 or more. Filter again to start from the first page',
        '#search'
      ]
    ])(
      'says %s=%s on the page, with an error summary that links to the field, the title starting "Error: " and a 400',
      async (name, value, text, href) => {
        mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

        const { statusCode, result } = await get(
          `/admin/deployments?${name}=${value}`
        )
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('title').text()).toContain('Error: Deployments - Admin')
        expect($('.govuk-error-summary__title').text().trim()).toBe(
          'There is a problem'
        )
        expect($('.govuk-error-summary a').text()).toBe(text)
        expect($('.govuk-error-summary a').attr('href')).toBe(href)
        expect($(href)).toHaveLength(1)
        expect(adminCalls()).toEqual([LIST])
        expect($('table')).toHaveLength(0)
      }
    )

    test('shows the error on the field, and keeps what was typed', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

      const $ = load((await get('/admin/deployments?search=a')).result)

      expect($('#search-error').text()).toContain(
        'Search must be 2 to 100 characters'
      )
      expect($('#search').val()).toBe('a')
      expect($('#search').attr('aria-describedby')).toContain('search-error')
    })

    test('links a bad environment to somewhere on the page', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: listing() })

      const { result } = await get('/admin/deployments?environment=BAD!')
      const $ = load(result)
      const href = $('.govuk-error-summary a').attr('href')

      expect($('.govuk-error-summary a').text()).toBe(
        'Choose an environment from the tabs'
      )
      expect($(href)).toHaveLength(1)
    })
  })

  describe('a query the backend refuses', () => {
    test('says the filters could not be used, linking to the form, and keeps what was typed', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}?environment=nowhere`]: reply(400, {
          code: 'invalid-query',
          message: 'Bad'
        }),
        [`GET ${LIST}`]: listing()
      })

      const { statusCode, result } = await get(
        '/admin/deployments?environment=nowhere'
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('.govuk-error-summary a').text()).toBe(
        'The filters could not be used. Clear the filters and try again'
      )
      expect($($('.govuk-error-summary a').attr('href'))).toHaveLength(1)
      expect($('title').text()).toContain('Error: Deployments - Admin')
    })
  })

  describe('what the backend refuses or cannot do', () => {
    test('shows the 403 page with the same title as its heading, and drops the Admin link', async () => {
      mockApi(fetchMock, { [`GET ${LIST}`]: FORBIDDEN })

      const { statusCode, result } = await get('/admin/deployments')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect($('h1').text()).toBe('Only a Platform Admin can use this page')
      expect($('title').text()).toContain(
        'Only a Platform Admin can use this page'
      )
    })

    test('shows the service unavailable page for a failing backend, with Try again to the same address', async () => {
      mockApi(fetchMock, {
        [`GET ${LIST}?environment=prod`]: reply(502, {
          code: 'upstream-unavailable',
          message: 'down'
        })
      })

      const { statusCode, result } = await get(
        '/admin/deployments?environment=prod'
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badGateway)
      expect($('h1').text()).toBe('We could not load this page')
      expect($('main .govuk-button').attr('href')).toBe(
        '/admin/deployments?environment=prod'
      )
    })
  })
})

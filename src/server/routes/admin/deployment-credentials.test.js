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

const API = '/v1/admin/team-deployments/team-1'
const DETAIL = `${API}/infradev`
const PAGE = '/admin/deployments/team-1/infradev'
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function answer(status, code) {
  return reply(status, { statusCode: status, code, message: 'Refused' })
}

const FORBIDDEN = answer(403, 'platform-admin-required')

function detail(overrides = {}) {
  return {
    team: {
      id: 'team-1',
      name: 'Flood Risk Team',
      status: 'active',
      memberCount: 3
    },
    environment: 'infradev',
    status: 'ready',
    credential: { status: 'active' },
    deployments: [],
    environments: [
      { environment: 'infradev', credential: { status: 'active' } },
      { environment: 'qa', credential: { status: 'active' } },
      { environment: 'prod', credential: { status: 'revoked' } }
    ],
    ...overrides
  }
}

const SECRET_REASON = 'Spotted at <b>jo.smith@defra.gov.uk</b> misusing it'

// A made-up form identifier (a version 4 UUID), not a secret.
const FORM_ID = 'c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b' // gitleaks:allow

describe('#admin deployment credentials', () => {
  let server
  let cookies
  let logged

  beforeAll(async () => {
    server = await createServer()
    // Everything the app could write to its log for a request, to prove the
    // reason is never in it (the reason is in its audit event only).
    server.events.on(
      { name: 'request', channels: ['app', 'error', 'internal'] },
      (_request, event) => logged.push(event)
    )
    server.ext('onRequest', (request, h) => {
      for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
        request.logger[level] = (...args) => logged.push(args)
      }

      return h.continue
    })
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    logged = []
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

  // What was sent to the backend that changes anything.
  function writes() {
    return fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .filter(([url]) => new URL(url).pathname.startsWith('/v1/admin'))
      .map(([url, init]) => ({
        path: new URL(url).pathname,
        body: init.body ? JSON.parse(init.body) : undefined,
        key: init.headers['idempotency-key']
      }))
  }

  function text(element) {
    return element.text().replace(/\s+/g, ' ').trim()
  }

  describe.each([
    ['disable', 'Disable credentials'],
    ['revoke', 'Revoke credentials'],
    ['enable', 'Enable credentials']
  ])(
    'the %s pages, asked of a person who may not or a team that is not there',
    (action) => {
      const BASE = `${PAGE}/credentials/${action}`

      test('redirects a signed out person to sign in', async () => {
        const { statusCode, headers } = await server.inject({
          method: 'GET',
          url: BASE
        })

        expect(statusCode).toBe(statusCodes.found)
        expect(headers.location).toContain('/sign-in')
      })

      test('shows the 403 page, with the same title as its heading', async () => {
        mockApi(fetchMock, { [`GET ${DETAIL}`]: FORBIDDEN })

        const { statusCode, result } = await get(BASE)
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.forbidden)
        expect($('h1').text()).toBe('Only a Platform Admin can use this page')
        expect($('title').text()).toContain(
          'Only a Platform Admin can use this page'
        )
      })

      test('shows the 403 page when the choice is posted, and changes nothing', async () => {
        mockApi(fetchMock, { [`GET ${DETAIL}`]: FORBIDDEN })

        const { statusCode } = await post(BASE, { environments: 'infradev' })

        expect(statusCode).toBe(statusCodes.forbidden)
        expect(writes()).toEqual([])
      })

      test('shows the 404 page for a deployment the backend does not have', async () => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: answer(404, 'deployment-not-found')
        })

        const { statusCode, result } = await get(BASE)

        expect(statusCode).toBe(statusCodes.notFound)
        expect(load(result)('h1').text()).toBe('Deployment not found')
      })

      test('shows the service unavailable page for a failing backend', async () => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: answer(502, 'upstream-unavailable')
        })

        const { statusCode } = await get(BASE)

        expect(statusCode).toBe(statusCodes.badGateway)
      })
    }
  )

  describe('"Which environments?"', () => {
    test('Disable: lists the team’s environments with the current one ticked, and says why a revoked one is still offered', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await get(`${PAGE}/credentials/disable`)
      const $ = load(result)
      const items = $('.govuk-checkboxes__item')

      expect(statusCode).toBe(statusCodes.ok)
      expect($('title').text()).toContain(
        'Disable credentials - Flood Risk Team - Admin'
      )
      expect($('h1').text()).toBe('Disable credentials')
      expect($('[data-testid="app-heading-caption"]').text()).toBe(
        'Flood Risk Team'
      )
      expect(text($('legend'))).toBe('Which environments?')
      expect(items.map((_, item) => text($(item).find('label'))).get()).toEqual(
        ['Development', 'Test', 'Production']
      )
      expect(
        items
          .map((_, item) => $(item).find('input').prop('checked') === true)
          .get()
      ).toEqual([true, false, false])
      expect(items.find('input').attr('name')).toBe('environments')
      expect(text($('.govuk-hint').last())).toContain(
        'Its credential is revoked. Disabling stops a new one being created.'
      )
      expect($('main form input[name="crumb"]')).toHaveLength(1)
      expect($('.govuk-back-link').attr('href')).toBe(PAGE)
      expect(
        $('.govuk-breadcrumbs__list-item')
          .map((_, item) => text($(item)))
          .get()
      ).toEqual([
        'Home',
        'Admin',
        'Deployments',
        'Development',
        'Flood Risk Team',
        'Disable credentials'
      ])
    })

    test('Revoke: lists only the environments with a credential the team holds', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const $ = load((await get(`${PAGE}/credentials/revoke`)).result)

      expect(
        $('.govuk-checkboxes__item label')
          .map((_, label) => text($(label)))
          .get()
      ).toEqual(['Development', 'Test'])
    })

    test('Enable: lists only the disabled environments, ticked from the current one, with a plain button', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail({
          credential: { status: 'disabled' },
          environments: [
            { environment: 'infradev', credential: { status: 'disabled' } },
            { environment: 'qa', credential: { status: 'active' } },
            { environment: 'prod', credential: { status: 'disabled' } }
          ]
        })
      })

      const $ = load((await get(`${PAGE}/credentials/enable`)).result)

      expect(
        $('.govuk-checkboxes__item label')
          .map((_, label) => text($(label)))
          .get()
      ).toEqual(['Development', 'Production'])
      expect($('.govuk-checkboxes__item input').first().prop('checked')).toBe(
        true
      )
      expect(text($('[data-testid="credentials-submit"]'))).toBe(
        'Enable credentials'
      )
      expect(
        $('[data-testid="credentials-submit"]').attr('class')
      ).not.toContain('govuk-button--')
    })

    test('says there is nothing to do when no environment is offered the action', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await get(`${PAGE}/credentials/enable`)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="nothing-to-do"]').text()).toContain(
        'No environment has its credentials disabled'
      )
      expect($('.govuk-checkboxes')).toHaveLength(0)
      expect($('[data-testid="credentials-submit"]')).toHaveLength(0)
    })

    test('ticks the environments posted back, when the page comes again with an error', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const $ = load((await post(`${PAGE}/credentials/disable`, {})).result)

      expect($('.govuk-checkboxes__item input:checked')).toHaveLength(0)
    })

    test('Disable and Revoke: posting a choice goes to the reason page with the environments named in the address', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const response = await post(`${PAGE}/credentials/disable`, {
        environments: ['infradev', 'prod']
      })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(
        `${PAGE}/credentials/disable/reason?environments=infradev,prod`
      )
      expect(writes()).toEqual([])
    })

    test.each([
      ['disable', {}],
      ['revoke', {}],
      [
        'enable',
        {
          credential: { status: 'disabled' },
          environments: [
            { environment: 'infradev', credential: { status: 'disabled' } }
          ]
        }
      ]
    ])(
      '%s: choosing nothing gives the error summary, linked to the checkboxes, the "Error: " title and a 400, and changes nothing',
      async (action, overrides) => {
        mockApi(fetchMock, { [`GET ${DETAIL}`]: detail(overrides) })

        const { statusCode, result } = await post(
          `${PAGE}/credentials/${action}`,
          {}
        )
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('title').text()).toContain('Error: ')
        expect($('.govuk-error-summary__title').text().trim()).toBe(
          'There is a problem'
        )
        expect($('.govuk-error-summary a').text()).toBe(
          'Choose at least one environment'
        )
        expect($($('.govuk-error-summary a').attr('href'))).toHaveLength(1)
        expect($('.govuk-error-message').text()).toContain(
          'Choose at least one environment'
        )
        expect(writes()).toEqual([])
      }
    )

    test('says an environment the action is not offered for is not on the list, and changes nothing', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await post(`${PAGE}/credentials/revoke`, {
        environments: 'prod'
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(load(result)('.govuk-error-summary a').text()).toBe(
        'Choose environments from the list'
      )
      expect(writes()).toEqual([])
    })

    test('shows the 404 page for an environment the team does not have, and changes nothing', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await post(`${PAGE}/credentials/disable`, {
        environments: ['infradev', 'nowhere']
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(load(result)('h1').text()).toBe('Deployment not found')
      expect(writes()).toEqual([])
    })
  })

  describe('the reason page', () => {
    const REASON = `${PAGE}/credentials/disable/reason?environments=infradev,qa`

    test('asks why, for the environments named, and says what the reason is for and that the team does not see it', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await get(REASON)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('title').text()).toContain(
        'Disable credentials in Development and Test - Flood Risk Team - Admin'
      )
      expect($('title').text()).not.toContain('Error:')
      expect($('h1').text()).toBe('Disable credentials in Development and Test')
      expect(text($('label[for="reason"]'))).toBe('Reason')
      expect(text($('#reason-hint'))).toBe(
        'This is saved in the audit log. The team cannot see it.'
      )
      expect(text($('.govuk-warning-text'))).toContain(
        'Do not include names or contact details'
      )
      expect(text($('[data-testid="credentials-effect"]'))).toContain(
        'The team cannot create new credentials or view or rotate its secrets in these environments. The team is not told why.'
      )
      expect($('textarea#reason').attr('name')).toBe('reason')
      expect(
        $('[data-module="govuk-character-count"]').attr('data-maxlength')
      ).toBe('500')
      expect($('input[name="formKey"]').attr('value')).toMatch(UUID_V4)
      expect($('main input[name="crumb"]')).toHaveLength(1)
      expect(text($('[data-testid="credentials-submit"]'))).toBe(
        'Disable credentials'
      )
      expect($('[data-testid="credentials-submit"]').attr('class')).toContain(
        'govuk-button--secondary'
      )
      expect($('[data-testid="credentials-cancel"]').attr('href')).toBe(PAGE)
      expect($('.govuk-back-link').attr('href')).toBe(
        `${PAGE}/credentials/disable?environments=infradev,qa`
      )
    })

    test('Revoke: has a red button and says it cannot be undone', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const $ = load(
        (await get(`${PAGE}/credentials/revoke/reason?environments=infradev`))
          .result
      )

      expect($('h1').text()).toBe('Revoke credentials in Development')
      expect($('[data-testid="credentials-submit"]').attr('class')).toContain(
        'govuk-button--warning'
      )
      expect(text($('[data-testid="credentials-effect"]'))).toContain(
        'Revoking cannot be undone. The secrets are deleted. The team is not told why.'
      )
    })

    test.each([
      ['none named', ''],
      ['an environment it is not offered for', '?environments=prod']
    ])(
      'goes back to the choice, with its error, for %s',
      async (_name, query) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail({
            environments: [
              { environment: 'infradev', credential: { status: 'active' } },
              { environment: 'prod', credential: { status: 'disabled' } }
            ]
          })
        })

        const { statusCode, result } = await get(
          `${PAGE}/credentials/disable/reason${query}`
        )
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('h1').text()).toBe('Disable credentials')
        expect($('.govuk-error-summary')).toHaveLength(1)
      }
    )

    test('shows the 404 page for an environment the team does not have', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode } = await get(
        `${PAGE}/credentials/disable/reason?environments=infradev,nowhere`
      )

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('shows the 404 page for a reason sent for an environment the team does not have, and changes nothing', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode } = await post(
        `${PAGE}/credentials/disable/reason?environments=infradev,nowhere`,
        { reason: 'Leaked' }
      )

      expect(statusCode).toBe(statusCodes.notFound)
      expect(writes()).toEqual([])
    })

    test('shows the error summary, the inline error and the "Error: " title for no reason, and keeps nothing changed', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await post(REASON, {
        reason: '   ',
        formKey: FORM_ID
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('title').text()).toContain('Error: Disable credentials in')
      expect($('.govuk-error-summary a').text()).toBe('Enter a reason')
      expect($('.govuk-error-summary a').attr('href')).toBe('#reason')
      expect($('#reason-error').text()).toContain('Enter a reason')
      expect($('textarea#reason').attr('aria-describedby')).toContain(
        'reason-error'
      )
      expect($('input[name="formKey"]').attr('value')).toBe(FORM_ID)
      expect(text($('[data-testid="credentials-effect"]'))).toContain(
        'The team is not told why'
      )
      expect(writes()).toEqual([])
    })

    test('says a reason over 500 characters is too long, and shows what was typed, escaped, as typed', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })
      const typed = `${SECRET_REASON} ${'x'.repeat(500)}`

      const { statusCode, result } = await post(REASON, { reason: typed })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('.govuk-error-summary a').text()).toBe(
        'Reason must be 500 characters or fewer'
      )
      expect($('textarea#reason').text()).toBe(typed)
      expect(result).not.toContain('<b>jo.smith@defra.gov.uk</b>')
      expect(writes()).toEqual([])
    })

    test('does one call for each environment, each with an Idempotency-Key of its own and the reason trimmed, then shows the panel', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/disable`]: {
          environment: 'infradev',
          credential: { status: 'disabled' }
        },
        [`POST ${API}/qa/credentials/disable`]: {
          environment: 'qa',
          credential: { status: 'disabled' }
        }
      })

      const response = await post(REASON, {
        reason: `  ${SECRET_REASON}  `,
        formKey: FORM_ID
      })
      const sent = writes()

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(
        `${PAGE}/credentials/disabled?environments=infradev,qa`
      )
      expect(sent.map(({ path }) => path)).toEqual([
        `${DETAIL}/credentials/disable`,
        `${API}/qa/credentials/disable`
      ])
      expect(sent.map(({ body }) => body)).toEqual([
        { reason: SECRET_REASON },
        { reason: SECRET_REASON }
      ])
      expect(sent[0].key).toMatch(UUID_V4)
      expect(sent[1].key).toMatch(UUID_V4)
      expect(sent[0].key).not.toBe(sent[1].key)
    })

    test('sends the same keys when the same form is sent again with the same reason, and others for another reason', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/disable`]: {},
        [`POST ${API}/qa/credentials/disable`]: {}
      })
      const form = { formKey: FORM_ID }

      await post(REASON, { ...form, reason: 'One reason' })
      await post(REASON, { ...form, reason: 'One reason' })
      await post(REASON, { ...form, reason: 'Another reason' })

      const keys = writes().map(({ key }) => key)

      expect(keys.slice(0, 2)).toEqual(keys.slice(2, 4))
      expect(keys.slice(4, 6)).not.toEqual(keys.slice(0, 2))
    })

    test('Revoke sends the revoke route', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/revoke`]: {
          environment: 'infradev',
          revoked: 1
        }
      })

      const response = await post(
        `${PAGE}/credentials/revoke/reason?environments=infradev`,
        { reason: 'Leaked' }
      )

      expect(writes().map(({ path }) => path)).toEqual([
        `${DETAIL}/credentials/revoke`
      ])
      expect(response.headers.location).toBe(
        `${PAGE}/credentials/revoked?environments=infradev`
      )
    })

    test('Revoke does not say "revoked" for an environment the backend revoked nothing in (P1-AC11), and says so on the deployment', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/revoke`]: {
          environment: 'infradev',
          revoked: 0
        },
        [`POST ${API}/qa/credentials/revoke`]: {
          environment: 'qa',
          revoked: 1
        }
      })

      const response = await post(
        `${PAGE}/credentials/revoke/reason?environments=infradev,qa`,
        { reason: 'Leaked' }
      )
      const page = load((await follow(response)).result)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)
      expect(page('[data-testid="team-notification"]').text()).toContain(
        'Credentials revoked in Test. There was no credential to revoke in Development.'
      )
    })

    test('Revoke with nothing revoked anywhere says only that there was none to revoke', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/revoke`]: {
          environment: 'infradev',
          revoked: 0
        }
      })

      const response = await post(
        `${PAGE}/credentials/revoke/reason?environments=infradev`,
        { reason: 'Leaked' }
      )
      const page = load((await follow(response)).result)

      expect(response.headers.location).toBe(PAGE)
      expect(text(page('[data-testid="team-notification"]'))).toContain(
        'There was no credential to revoke in Development.'
      )
      expect(page('[data-testid="team-notification"]').text()).not.toContain(
        'Credentials revoked'
      )
    })

    test('names the environment that failed, shows no success, says what stands, and offers Try again for the failed one', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/disable`]: {},
        [`POST ${API}/qa/credentials/disable`]: answer(
          502,
          'upstream-unavailable'
        )
      })

      const { statusCode, result } = await post(REASON, { reason: 'Leaked' })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badGateway)
      expect($('h1').text()).toBe(
        'We could not disable the credentials in Test'
      )
      expect($('title').text()).toContain(
        'We could not disable the credentials in Test'
      )
      expect($('.govuk-panel')).toHaveLength(0)
      expect(text($('[data-testid="credentials-done"]'))).toBe(
        'Credentials were disabled in Development.'
      )
      expect($('[data-testid="credentials-retry"]').text().trim()).toBe(
        'Try again'
      )
      expect($('[data-testid="credentials-retry"]').attr('href')).toBe(
        `${PAGE}/credentials/disable/reason?environments=qa`
      )
      expect($('[data-testid="credentials-back"]').attr('href')).toBe(PAGE)
      expect(result).not.toContain('Leaked')
    })

    test('says so when none of them worked', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/disable`]: answer(
          502,
          'upstream-unavailable'
        ),
        [`POST ${API}/qa/credentials/disable`]: answer(
          502,
          'upstream-unavailable'
        )
      })

      const $ = load((await post(REASON, { reason: 'Leaked' })).result)

      expect($('h1').text()).toBe(
        'We could not disable the credentials in Development and Test'
      )
      expect($('[data-testid="credentials-done"]')).toHaveLength(0)
      expect($('[data-testid="credentials-retry"]').attr('href')).toBe(
        `${PAGE}/credentials/disable/reason?environments=infradev,qa`
      )
    })

    test('a request that is refused as not a Platform Admin shows the 403 page, whichever environment', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/disable`]: FORBIDDEN
      })

      const { statusCode } = await post(REASON, { reason: 'Leaked' })

      expect(statusCode).toBe(statusCodes.forbidden)
    })

    test('a team or environment that has gone shows the 404 page', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/disable`]: answer(
          404,
          'deployment-not-found'
        )
      })

      const { statusCode } = await post(REASON, { reason: 'Leaked' })

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test.each([
      ['reason-required', 'Enter a reason'],
      ['reason-too-long', 'Reason must be 500 characters or fewer']
    ])(
      'puts a %s the backend gives on the reason field',
      async (code, message) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail(),
          [`POST ${DETAIL}/credentials/disable`]: answer(400, code)
        })

        const { statusCode, result } = await post(REASON, { reason: 'Leaked' })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('.govuk-error-summary a').text()).toBe(message)
        expect($('.govuk-error-summary a').attr('href')).toBe('#reason')
      }
    )

    test('refuses a post with no crumb, and changes nothing', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode } = await server.inject({
        method: 'POST',
        url: REASON,
        headers: { cookie: cookieHeader(cookies) },
        payload: { reason: 'Leaked' }
      })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(writes()).toEqual([])
    })

    test('writes the reason to no log, and to no page but its own form', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${DETAIL}/credentials/disable`]: answer(
          502,
          'upstream-unavailable'
        ),
        [`POST ${API}/qa/credentials/disable`]: {}
      })

      const failed = await post(REASON, { reason: SECRET_REASON })

      expect(JSON.stringify(logged)).not.toContain('jo.smith')
      expect(JSON.stringify(logged)).not.toContain('misusing')
      expect(failed.result).not.toContain('misusing')
    })
  })

  describe('the confirmation', () => {
    const blocked = { status: 'disabled', held: 'revoked' }

    test.each([
      [
        'disabled',
        'Credentials disabled',
        'The team cannot create new credentials or view or rotate its secrets in these environments. The team is not told why.',
        { status: 'disabled' }
      ],
      [
        'revoked',
        'Credentials revoked',
        'Revoking cannot be undone. The secrets are deleted. The team is not told why.',
        blocked
      ]
    ])(
      '%s: shows a panel naming the environments, what is true now and a way back',
      async (word, title, effect, credential) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail({
            environments: [
              { environment: 'infradev', credential },
              { environment: 'qa', credential },
              { environment: 'prod', credential: { status: 'revoked' } }
            ]
          })
        })

        const { statusCode, result } = await get(
          `${PAGE}/credentials/${word}?environments=infradev,qa`
        )
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.ok)
        expect($('title').text()).toContain(`${title} - Flood Risk Team`)
        expect($('.govuk-panel__title').text().trim()).toBe(title)
        expect(text($('.govuk-panel__body'))).toBe('in Development and Test')
        expect(text($('[data-testid="credentials-effect"]'))).toBe(effect)
        expect($('[data-testid="credentials-back"]').attr('href')).toBe(PAGE)
      }
    )

    test.each([
      ['disabled', { status: 'active' }],
      ['revoked', { status: 'active' }],
      ['revoked', { status: 'disabled', held: 'active' }]
    ])(
      '%s: does not say it happened when an environment is %j, and goes to the deployment (a bookmark or Back)',
      async (word, credential) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail({
            environments: [
              { environment: 'infradev', credential: { status: 'revoked' } },
              { environment: 'qa', credential }
            ]
          })
        })

        const response = await get(
          `${PAGE}/credentials/${word}?environments=infradev,qa`
        )

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(PAGE)
        expect(response.result).not.toContain('Credentials revoked')
      }
    )

    test('shows the 404 page for an environment the team does not have, so an address cannot say what it likes', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await get(
        `${PAGE}/credentials/disabled?environments=%3Cb%3Ex%3C%2Fb%3E`
      )

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).not.toContain('<b>x</b>')
    })

    test('shows the 404 page with no environments named', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode } = await get(`${PAGE}/credentials/revoked`)

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('shows the 403 page for a person who is not a Platform Admin', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: FORBIDDEN })

      const { statusCode } = await get(
        `${PAGE}/credentials/disabled?environments=infradev`
      )

      expect(statusCode).toBe(statusCodes.forbidden)
    })
  })

  describe('Enable', () => {
    const ENABLE = `${PAGE}/credentials/enable`
    const disabled = () =>
      detail({
        credential: { status: 'disabled' },
        environments: [
          { environment: 'infradev', credential: { status: 'disabled' } },
          { environment: 'qa', credential: { status: 'disabled' } }
        ]
      })

    test('acts at once, with no reason, key or confirmation page, and returns with a notification', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: disabled(),
        [`POST ${DETAIL}/credentials/enable`]: {},
        [`POST ${API}/qa/credentials/enable`]: {}
      })

      const response = await post(ENABLE, { environments: ['infradev', 'qa'] })
      const page = load((await follow(response)).result)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)
      expect(writes()).toEqual([
        {
          path: `${DETAIL}/credentials/enable`,
          body: undefined,
          key: undefined
        },
        {
          path: `${API}/qa/credentials/enable`,
          body: undefined,
          key: undefined
        }
      ])
      expect(page('[data-testid="team-notification"]').text()).toContain(
        'Credentials enabled in Development and Test.'
      )
    })

    test('names the environment that failed, shows no success, and offers Try again', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: disabled(),
        [`POST ${DETAIL}/credentials/enable`]: {},
        [`POST ${API}/qa/credentials/enable`]: answer(
          502,
          'upstream-unavailable'
        )
      })

      const { statusCode, result } = await post(ENABLE, {
        environments: ['infradev', 'qa']
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badGateway)
      expect($('h1').text()).toBe('We could not enable the credentials in Test')
      expect(text($('[data-testid="credentials-done"]'))).toBe(
        'Credentials were enabled in Development.'
      )
      expect($('[data-testid="credentials-retry"]').attr('href')).toBe(
        `${ENABLE}?environments=qa`
      )
    })
  })
})

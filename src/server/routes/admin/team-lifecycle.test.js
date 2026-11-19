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

const API = '/v1/admin/teams/team-1'
const PAGE = '/admin/teams/team-1'
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
// A made-up form identifier (a version 4 UUID), not a secret.
const FORM_ID = 'c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b' // gitleaks:allow

function answer(status, code) {
  return reply(status, { statusCode: status, code, message: 'Refused' })
}

const FORBIDDEN = answer(403, 'platform-admin-required')

const ENVIRONMENTS_OPEN = [
  { environment: 'infradev', fileStatus: 'active', disabled: false },
  { environment: 'qa', fileStatus: 'active', disabled: false }
]
const INFRADEV_DISABLED = [
  { environment: 'infradev', fileStatus: 'active', disabled: true },
  { environment: 'qa', fileStatus: 'active', disabled: false }
]

// The admin read of a team in Development and Test, active unless changed.
function teamRead(team = {}) {
  return {
    team: {
      id: 'team-1',
      name: 'Flood Risk Team',
      slug: 'flood-risk-team',
      serviceCode: 'FRM',
      status: 'active',
      disabledEnvironments: [],
      environments: ENVIRONMENTS_OPEN,
      ...team
    },
    members: []
  }
}

const ACTIVE = teamRead()
const DISABLED_ALONE = teamRead({ status: 'disabled' })
const ENVIRONMENT_DISABLED = teamRead({
  disabledEnvironments: ['infradev'],
  environments: INFRADEV_DISABLED
})
const TEAM_AND_ENVIRONMENT_DISABLED = teamRead({
  status: 'disabled',
  disabledEnvironments: ['infradev'],
  environments: INFRADEV_DISABLED
})
const PENDING_REMOVAL = teamRead({ status: 'pending-removal' })

function text(element) {
  return element.text().replace(/\s+/g, ' ').trim()
}

describe('#admin disable and enable a team', () => {
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

  async function teamPage(read) {
    mockApi(fetchMock, { [`GET ${API}`]: read })

    return load((await get(PAGE)).result)
  }

  describe('the admin team page offers one lifecycle action, never both', () => {
    test('offers a secondary Disable team link to an active team, and no Enable', async () => {
      const $ = await teamPage(ACTIVE)
      const button = $('[data-testid="disable-team"]')

      expect(button.attr('href')).toBe(`${PAGE}/disable`)
      expect(button.attr('class')).toContain('govuk-button--secondary')
      expect($('[data-testid="enable-team"]')).toHaveLength(0)
      expect($('[data-testid="team-disabled-warning"]')).toHaveLength(0)
    })

    test('offers a primary Enable team button, posted with the CSRF crumb, to a disabled team, and no Disable', async () => {
      const $ = await teamPage(DISABLED_ALONE)
      const button = $('[data-testid="enable-team"]')
      const form = button.closest('form')

      expect(button.text().trim()).toBe('Enable team')
      expect(button.attr('class')).not.toContain('govuk-button--secondary')
      expect(form.attr('method')).toBe('post')
      expect(form.attr('action')).toBe(`${PAGE}/enable`)
      expect(form.find('input[name="crumb"]').val()).toBe(cookies.crumb)
      expect($('[data-testid="disable-team"]')).toHaveLength(0)
    })

    test.each([
      ['an active team with every environment open', ACTIVE, 'disable-team'],
      [
        'an active team with an environment disabled',
        ENVIRONMENT_DISABLED,
        'disable-team'
      ],
      ['a disabled team alone', DISABLED_ALONE, 'enable-team'],
      [
        'a disabled team with an environment disabled',
        TEAM_AND_ENVIRONMENT_DISABLED,
        'enable-team'
      ],
      ['a team waiting to be removed', PENDING_REMOVAL, null]
    ])(
      'for %s shows exactly the right single button in the one actions group',
      async (_name, read, expected) => {
        const $ = await teamPage(read)
        const everything = $(
          '[data-testid="disable-team"], [data-testid="enable-team"]'
        )

        expect(everything).toHaveLength(expected ? 1 : 0)

        if (expected) {
          expect($(`[data-testid="${expected}"]`)).toHaveLength(1)
          expect(
            $('[data-testid="team-lifecycle-actions"] .govuk-button')
          ).toHaveLength(1)
        } else {
          expect($('[data-testid="team-lifecycle-actions"]')).toHaveLength(0)
        }
      }
    )

    test('an environment that is disabled never turns an active team’s Disable team into Enable team', async () => {
      const $ = await teamPage(ENVIRONMENT_DISABLED)

      expect($('[data-testid="disable-team"]')).toHaveLength(1)
      expect($('[data-testid="enable-team"]')).toHaveLength(0)
    })

    test('puts the button group after the summary and before the audit log link and the members', async () => {
      const $ = await teamPage(DISABLED_ALONE)
      const order = $(
        '[data-testid="team-summary"], [data-testid="team-lifecycle-actions"], [data-testid="view-audit-log"], h2.govuk-heading-l'
      )
        .map((_, element) => $(element).attr('data-testid') ?? 'members')
        .get()

      expect(order).toEqual([
        'team-summary',
        'team-lifecycle-actions',
        'view-audit-log',
        'members'
      ])
    })

    test('never asks for an environment on the team page', async () => {
      for (const read of [ACTIVE, DISABLED_ALONE, ENVIRONMENT_DISABLED]) {
        const $ = await teamPage(read)

        expect($('input[type="checkbox"]')).toHaveLength(0)
        expect($('input[name="environments"]')).toHaveLength(0)
      }
    })

    test('says a disabled team is view-only for its details and members, and that its environments carry on', async () => {
      const $ = await teamPage(DISABLED_ALONE)

      expect(text($('[data-testid="team-summary"] .govuk-tag').first())).toBe(
        'Disabled'
      )
      expect(text($('[data-testid="team-disabled-warning"]'))).toContain(
        'This team is disabled. Its people can view it but not change its details or members. Its environments, models and credentials are not affected.'
      )
      expect($('[data-testid="environment-disabled"]')).toHaveLength(0)
    })

    test('says an environment is disabled as its own thing, naming the environment, when the team itself is active', async () => {
      const $ = await teamPage(ENVIRONMENT_DISABLED)
      const warning = text($('[data-testid="team-disabled-warning"]'))

      expect(warning).toContain('Development is disabled')
      expect(warning).toContain('credentials are disabled there')
      expect(warning).not.toContain('This team is disabled')
      expect(text($('[data-testid="team-summary"] .govuk-tag').first())).toBe(
        'Active'
      )
    })

    test('says both when the team and an environment are disabled', async () => {
      const $ = await teamPage(TEAM_AND_ENVIRONMENT_DISABLED)
      const warning = text($('[data-testid="team-disabled-warning"]'))

      expect(warning).toContain('This team is disabled.')
      expect(warning).toContain('Development is disabled')
    })

    test('shows a disabled environment as Disabled alone, never also Active', async () => {
      const $ = await teamPage(ENVIRONMENT_DISABLED)
      const rows = $('[data-testid="team-environments"] li')
        .map((_, row) => text($(row)))
        .get()

      expect(rows).toEqual(['Development: Disabled', 'Test: Active'])
      expect($('[data-testid="environment-disabled"]')).toHaveLength(1)
    })

    test('keeps the file status beside Disabled when it is not Active', async () => {
      const $ = await teamPage(
        teamRead({
          environments: [
            {
              environment: 'infradev',
              fileStatus: 'pending-removal',
              disabled: true
            }
          ]
        })
      )

      expect(text($('[data-testid="team-environments"] li'))).toContain(
        'Development: Pending removal Disabled'
      )
      expect($('[data-testid="environment-disabled"]')).toHaveLength(1)
    })

    test('does not tag a removed environment Disabled', async () => {
      const $ = await teamPage(
        teamRead({
          environments: [
            { environment: 'prod', fileStatus: 'removed', disabled: true }
          ]
        })
      )

      expect($('[data-testid="environment-disabled"]')).toHaveLength(0)
    })
  })

  describe('every page, asked of a person who may not or a team that is not there', () => {
    test.each(['disable'])(
      'redirects a signed out person asking for %s to sign in',
      async (path) => {
        const { statusCode, headers } = await server.inject({
          method: 'GET',
          url: `${PAGE}/${path}`
        })

        expect(statusCode).toBe(statusCodes.found)
        expect(headers.location).toContain('/sign-in')
      }
    )

    describe.each([
      ['GET', 'disable'],
      ['POST', 'disable'],
      ['POST', 'enable']
    ])('%s %s', (method, path) => {
      const url = `${PAGE}/${path}`
      const ask = () =>
        method === 'GET' ? get(url) : post(url, { reason: 'x' })

      test('shows the 403 page to a person who is not a Platform Admin, and changes nothing', async () => {
        mockApi(fetchMock, { [`GET ${API}`]: FORBIDDEN })

        const { statusCode, result } = await ask()
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.forbidden)
        expect($('h1').text()).toBe('Only a Platform Admin can use this page')
        expect(writes()).toEqual([])
      })

      test('shows the 404 page for a team the backend does not have', async () => {
        mockApi(fetchMock, { [`GET ${API}`]: answer(404, 'team-not-found') })

        const { statusCode, result } = await ask()

        expect(statusCode).toBe(statusCodes.notFound)
        expect(load(result)('h1').text()).toBe('Team not found')
      })
    })

    test('shows a backend that is down as the page that says so', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: answer(502, 'upstream-unavailable')
      })

      expect((await get(`${PAGE}/disable`)).statusCode).toBe(
        statusCodes.badGateway
      )
    })
  })

  describe('there are no pages that ask for an environment, a step or a confirmation', () => {
    test.each([
      ['GET', 'enable'],
      ['GET', 'disable/reason'],
      ['POST', 'disable/reason'],
      ['GET', 'disabled']
    ])('%s %s is not a page', async (method, path) => {
      mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

      const response =
        method === 'GET'
          ? await get(`${PAGE}/${path}`)
          : await post(`${PAGE}/${path}`, { reason: 'x' })

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(writes()).toEqual([])
    })
  })

  describe('Disable team: the reason, then one call', () => {
    test('asks for the reason straight away, with no environment choice', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

      const { statusCode, result } = await get(`${PAGE}/disable`)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text().trim()).toContain('Disable team')
      expect($('input[type="checkbox"]')).toHaveLength(0)
      expect($('input[name="environments"]')).toHaveLength(0)
      expect($('textarea[name="reason"]')).toHaveLength(1)
      expect($('input[name="formKey"]').val()).toMatch(UUID_V4)
      expect($('[data-testid="credentials-submit"]').attr('class')).toContain(
        'govuk-button--secondary'
      )
      expect($('[data-testid="credentials-cancel"]').attr('href')).toBe(PAGE)
      expect($('.govuk-back-link').attr('href')).toBe(PAGE)
    })

    test('says what happens, that nothing in an environment changes, and that the team is not told why', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

      const $ = load((await get(`${PAGE}/disable`)).result)

      expect(text($('[data-testid="credentials-effect"]'))).toBe(
        'People in Flood Risk Team can view it but not change its details or its members. The team is not told why.'
      )
      expect(text($('[data-testid="credentials-note"]'))).toContain(
        'the team can still deploy models and create credentials'
      )
      expect(text($('[data-testid="credentials-note"]'))).toContain(
        'disable its credentials on the Deployments tab'
      )
    })

    test.each([
      ['a disabled team', DISABLED_ALONE],
      ['a team waiting to be removed', PENDING_REMOVAL]
    ])(
      'goes back to the team instead of asking for a reason for %s',
      async (_name, read) => {
        mockApi(fetchMock, { [`GET ${API}`]: read })

        const response = await get(`${PAGE}/disable`)

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(PAGE)
      }
    )

    test('disables the team in one call with the reason only and an Idempotency-Key, then returns to the team with a success notification', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: {
          team: { id: 'team-1', status: 'disabled', disabledEnvironments: [] }
        }
      })

      const response = await post(`${PAGE}/disable`, {
        reason: '  Suspected misuse  ',
        formKey: FORM_ID
      })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)
      expect(writes()).toEqual([
        {
          path: `${API}/disable`,
          body: { reason: 'Suspected misuse' },
          key: expect.stringMatching(UUID_V4)
        }
      ])

      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_ALONE })

      const $ = load((await follow(response)).result)

      expect(text($('[data-testid="team-notification"]'))).toContain(
        'Flood Risk Team is disabled.'
      )
      expect($('[data-testid="team-notification"]').attr('class')).toContain(
        'govuk-notification-banner--success'
      )
    })

    test('switches the team page from Disable team to Enable team once it is disabled', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: { team: { id: 'team-1', status: 'disabled' } }
      })

      const before = load((await get(PAGE)).result)
      const response = await post(`${PAGE}/disable`, {
        reason: 'Investigating',
        formKey: FORM_ID
      })

      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_ALONE })

      const after = load((await follow(response)).result)

      expect(before('[data-testid="disable-team"]')).toHaveLength(1)
      expect(before('[data-testid="enable-team"]')).toHaveLength(0)
      expect(after('[data-testid="disable-team"]')).toHaveLength(0)
      expect(after('[data-testid="enable-team"]')).toHaveLength(1)
    })

    test('sends the same key for the same form and reason, so a repeat changes nothing, and another for another reason or form', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: { team: { id: 'team-1', status: 'disabled' } }
      })
      const send = (reason, formKey = FORM_ID) =>
        post(`${PAGE}/disable`, { reason, formKey })

      await send('Same reason')
      await send('Same reason')
      await send('Another reason')
      await send('Same reason', 'd1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b')

      const keys = writes().map(({ key }) => key)

      expect(keys[0]).toBe(keys[1])
      expect(keys[2]).not.toBe(keys[0])
      expect(keys[3]).not.toBe(keys[0])
    })

    test('never puts the reason in the address or the log', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: { team: { id: 'team-1', status: 'disabled' } }
      })

      const response = await post(`${PAGE}/disable`, {
        reason: 'Mentions jo.smith@defra.gov.uk',
        formKey: FORM_ID
      })

      expect(response.headers.location).not.toContain('jo.smith')
      expect(JSON.stringify(logged)).not.toContain('jo.smith')
    })

    test.each([
      ['nothing', {}],
      ['only spaces', { reason: '   ' }]
    ])(
      'shows an error, keeps the page and calls nothing when the reason is %s',
      async (_name, payload) => {
        mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

        const { statusCode, result } = await post(`${PAGE}/disable`, {
          ...payload,
          formKey: FORM_ID
        })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('title').text().trim()).toMatch(/^Error: /)
        expect(text($('.govuk-error-summary'))).toContain('Enter a reason')
        expect($('.govuk-error-summary a').attr('href')).toBe('#reason')
        expect(writes()).toEqual([])
      }
    )

    test('says a reason the backend will not take, with the text kept', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: answer(400, 'reason-too-long')
      })

      const { statusCode, result } = await post(`${PAGE}/disable`, {
        reason: 'Some reason',
        formKey: FORM_ID
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(text($('.govuk-error-summary'))).toContain(
        'Reason must be 500 characters or fewer'
      )
      expect($('textarea[name="reason"]').text().trim()).toBe('Some reason')
    })

    test.each([
      ['fails', answer(502, 'upstream-unavailable')],
      [
        'refuses the key as used for another request',
        answer(409, 'idempotency-key-reused')
      ]
    ])(
      'says the team could not be disabled, with no success and a Try again that goes back to the reason, when the backend %s',
      async (_what, refusal) => {
        mockApi(fetchMock, {
          [`GET ${API}`]: ACTIVE,
          [`POST ${API}/disable`]: refusal
        })

        const { statusCode, result } = await post(`${PAGE}/disable`, {
          reason: 'Some reason',
          formKey: FORM_ID
        })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badGateway)
        expect($('h1').text()).toBe('We could not disable Flood Risk Team')
        expect($('[data-testid="credentials-retry"]').attr('href')).toBe(
          `${PAGE}/disable`
        )
        expect($('[data-testid="credentials-back"]').attr('href')).toBe(PAGE)
      }
    )

    test('lets the 403 of a person who lost the role through to the 403 page', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: FORBIDDEN
      })

      const { statusCode } = await post(`${PAGE}/disable`, {
        reason: 'Some reason',
        formKey: FORM_ID
      })

      expect(statusCode).toBe(statusCodes.forbidden)
    })

    test.each([
      ['a disabled team', DISABLED_ALONE],
      ['a team waiting to be removed', PENDING_REMOVAL]
    ])(
      'calls nothing and goes back to the team when %s is posted to',
      async (_name, read) => {
        mockApi(fetchMock, { [`GET ${API}`]: read })

        const response = await post(`${PAGE}/disable`, {
          reason: 'Some reason',
          formKey: FORM_ID
        })

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(PAGE)
        expect(writes()).toEqual([])
      }
    )
  })

  describe('Enable team: one button, one call', () => {
    test('lifts the team lock with no reason, no key and no environments, then returns to the team with a success notification', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: TEAM_AND_ENVIRONMENT_DISABLED,
        [`POST ${API}/enable`]: {
          team: {
            id: 'team-1',
            status: 'active',
            disabledEnvironments: ['infradev']
          }
        }
      })

      const response = await post(`${PAGE}/enable`)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)
      expect(writes()).toEqual([
        { path: `${API}/enable`, body: {}, key: undefined }
      ])

      mockApi(fetchMock, { [`GET ${API}`]: ENVIRONMENT_DISABLED })

      const $ = load((await follow(response)).result)

      expect(text($('[data-testid="team-notification"]'))).toContain(
        'Flood Risk Team is enabled.'
      )
      expect($('[data-testid="team-notification"]').attr('class')).toContain(
        'govuk-notification-banner--success'
      )
    })

    test('switches the team page from Enable team to Disable team once it is enabled, whatever its environments', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: TEAM_AND_ENVIRONMENT_DISABLED,
        [`POST ${API}/enable`]: { team: { id: 'team-1', status: 'active' } }
      })

      const before = load((await get(PAGE)).result)
      const response = await post(`${PAGE}/enable`)

      mockApi(fetchMock, { [`GET ${API}`]: ENVIRONMENT_DISABLED })

      const after = load((await follow(response)).result)

      expect(before('[data-testid="enable-team"]')).toHaveLength(1)
      expect(before('[data-testid="disable-team"]')).toHaveLength(0)
      expect(after('[data-testid="enable-team"]')).toHaveLength(0)
      expect(after('[data-testid="disable-team"]')).toHaveLength(1)
    })

    test.each([
      ['an active team', ACTIVE],
      ['a team waiting to be removed', PENDING_REMOVAL]
    ])(
      'calls nothing and shows %s as it is, because there is nothing to enable',
      async (_name, read) => {
        mockApi(fetchMock, { [`GET ${API}`]: read })

        const response = await post(`${PAGE}/enable`)

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(PAGE)
        expect(writes()).toEqual([])
      }
    )

    test('says the team could not be enabled, on the team page, when the backend fails, and does not say it was enabled', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: DISABLED_ALONE,
        [`POST ${API}/enable`]: answer(502, 'upstream-unavailable')
      })

      const response = await post(`${PAGE}/enable`)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)

      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_ALONE })

      const $ = load((await follow(response)).result)
      const banner = $('[data-testid="team-notification"]')

      expect(text(banner)).toContain('We could not enable Flood Risk Team')
      expect(banner.attr('class')).not.toContain(
        'govuk-notification-banner--success'
      )
      expect(text(banner)).not.toContain('is enabled')
      expect($('[data-testid="enable-team"]')).toHaveLength(1)
    })

    test('lets a refusal it cannot put right through to the page that says so', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: DISABLED_ALONE,
        [`POST ${API}/enable`]: answer(400, 'invalid-request')
      })

      const { statusCode } = await post(`${PAGE}/enable`)

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  test('needs the CSRF crumb on every POST', async () => {
    mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

    for (const path of ['disable', 'enable']) {
      const { statusCode } = await server.inject({
        method: 'POST',
        url: `${PAGE}/${path}`,
        headers: { cookie: cookieHeader(cookies) },
        payload: { reason: 'x' }
      })

      expect(statusCode).toBe(statusCodes.forbidden)
    }

    expect(writes()).toEqual([])
  })
})

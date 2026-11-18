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
      environments: [
        { environment: 'infradev', fileStatus: 'active', disabled: false },
        { environment: 'qa', fileStatus: 'active', disabled: false }
      ],
      ...team
    },
    members: []
  }
}

const ACTIVE = teamRead()
const DISABLED_BOTH = teamRead({
  status: 'disabled',
  disabledEnvironments: ['infradev', 'qa'],
  environments: [
    { environment: 'infradev', fileStatus: 'active', disabled: true },
    { environment: 'qa', fileStatus: 'active', disabled: true }
  ]
})
const DISABLED_ALONE = teamRead({ status: 'disabled' })
const DEVELOPMENT_ONLY = teamRead({
  status: 'active',
  disabledEnvironments: ['infradev'],
  environments: [
    { environment: 'infradev', fileStatus: 'active', disabled: true },
    { environment: 'qa', fileStatus: 'active', disabled: false }
  ]
})

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

  function checkboxes($) {
    return $('input[name="environments"]')
      .map((_, input) => ({
        value: $(input).val(),
        checked: $(input).attr('checked') !== undefined
      }))
      .get()
  }

  describe('the admin team page', () => {
    test('offers a secondary Disable team button to an active team, and no Enable', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

      const $ = load((await get(PAGE)).result)
      const button = $('[data-testid="disable-team"]')

      expect(button.attr('href')).toBe(`${PAGE}/disable`)
      expect(button.attr('class')).toContain('govuk-button--secondary')
      expect($('[data-testid="enable-team"]')).toHaveLength(0)
      expect($('[data-testid="team-disabled-warning"]')).toHaveLength(0)
    })

    test('shows a disabled team Disabled with a warning, each disabled environment tagged, and Enable team but not Disable', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_BOTH })

      const $ = load((await get(PAGE)).result)

      expect(text($('[data-testid="team-summary"] .govuk-tag').first())).toBe(
        'Disabled'
      )
      expect(text($('[data-testid="team-disabled-warning"]'))).toContain(
        'This team is disabled. Its people can view it but not change it. Its credentials keep working.'
      )
      expect($('[data-testid="environment-disabled"]')).toHaveLength(2)
      expect($('[data-testid="enable-team"]').attr('href')).toBe(
        `${PAGE}/enable`
      )
      expect($('[data-testid="disable-team"]')).toHaveLength(0)
    })

    test('offers Enable team, and a warning that names the environment, when only an environment is disabled', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })

      const $ = load((await get(PAGE)).result)

      expect(text($('[data-testid="team-disabled-warning"]'))).toContain(
        'Development is disabled. The team’s people can view it but not change it.'
      )
      expect($('[data-testid="enable-team"]')).toHaveLength(1)
      expect($('[data-testid="environment-disabled"]')).toHaveLength(1)
    })

    test('shows a disabled environment as Disabled alone, never also Active', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })

      const $ = load((await get(PAGE)).result)
      const rows = $('[data-testid="team-environments"] li')
        .map((_, row) => text($(row)))
        .get()

      expect(rows).toEqual(['Development: Disabled', 'Test: Active'])
      expect($('[data-testid="environment-disabled"]')).toHaveLength(1)
    })

    test('keeps the file status beside Disabled when it is not Active', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: teamRead({
          environments: [
            {
              environment: 'infradev',
              fileStatus: 'pending-removal',
              disabled: true
            }
          ]
        })
      })

      const $ = load((await get(PAGE)).result)

      expect(text($('[data-testid="team-environments"] li'))).toContain(
        'Development: Pending removal Disabled'
      )
      expect($('[data-testid="environment-disabled"]')).toHaveLength(1)
    })

    test('does not tag a removed environment Disabled', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: teamRead({
          environments: [
            { environment: 'prod', fileStatus: 'removed', disabled: true }
          ]
        })
      })

      const $ = load((await get(PAGE)).result)

      expect($('[data-testid="environment-disabled"]')).toHaveLength(0)
    })
  })

  describe('every page, asked of a person who may not or a team that is not there', () => {
    test.each(['disable', 'disable/reason', 'enable', 'disabled'])(
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
      ['GET', 'disable/reason'],
      ['GET', 'enable'],
      ['GET', 'disabled'],
      ['POST', 'disable'],
      ['POST', 'disable/reason'],
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

  describe('Which environments? (Disable team)', () => {
    beforeEach(() => {
      mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })
    })

    test('offers the team’s environments unticked, says unticked ones stay usable, and allows none', async () => {
      const { statusCode, result } = await get(`${PAGE}/disable`)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text()).toBe('Disable team')
      expect(text($('legend'))).toBe('Which environments?')
      expect(text($('#environments-hint'))).toContain(
        'Environments you do not tick stay usable.'
      )
      expect(checkboxes($)).toEqual([
        { value: 'infradev', checked: false },
        { value: 'qa', checked: false }
      ])
      expect($('main input[name="crumb"]')).toHaveLength(1)
      expect(text($('[data-testid="credentials-submit"]'))).toBe('Continue')
      expect($('[data-testid="credentials-cancel"]').attr('href')).toBe(PAGE)
    })

    test('offers only the environments not disabled already, and not one that was removed', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: teamRead({
          status: 'active',
          environments: [
            { environment: 'infradev', fileStatus: 'active', disabled: true },
            { environment: 'qa', fileStatus: 'active' },
            { environment: 'prod', fileStatus: 'removed' }
          ]
        })
      })

      const $ = load((await get(`${PAGE}/disable`)).result)

      expect(checkboxes($).map(({ value }) => value)).toEqual(['qa'])
    })

    test('says so, and still lets the team be disabled, when every environment is disabled already', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_BOTH })

      const $ = load((await get(`${PAGE}/disable`)).result)

      expect(checkboxes($)).toEqual([])
      expect(text($('[data-testid="no-environments"]'))).toBe(
        'Every environment is already disabled. You can still disable the team.'
      )
      expect($('[data-testid="credentials-submit"]')).toHaveLength(1)
    })

    test('says there are no models to disable when the team has deployed none', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: teamRead({ environments: [] })
      })

      const $ = load((await get(`${PAGE}/disable`)).result)

      expect(checkboxes($)).toEqual([])
      expect(text($('[data-testid="no-environments"]'))).toBe(
        'There are no models to disable. You can still disable the team.'
      )
      expect($('[data-testid="credentials-submit"]')).toHaveLength(1)
    })

    test('ticks what the address names', async () => {
      const $ = load((await get(`${PAGE}/disable?environments=qa`)).result)

      expect(checkboxes($)).toEqual([
        { value: 'infradev', checked: false },
        { value: 'qa', checked: true }
      ])
    })

    test('goes on to the reason with none ticked, which is allowed', async () => {
      const response = await post(`${PAGE}/disable`, {})

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(`${PAGE}/disable/reason`)
      expect(writes()).toEqual([])
    })

    test('goes on to the reason with the environments ticked, one or several', async () => {
      expect(
        (await post(`${PAGE}/disable`, { environments: 'infradev' })).headers
          .location
      ).toBe(`${PAGE}/disable/reason?environments=infradev`)
      expect(
        (await post(`${PAGE}/disable`, { environments: ['infradev', 'qa'] }))
          .headers.location
      ).toBe(`${PAGE}/disable/reason?environments=infradev,qa`)
    })

    test('shows the choice again, with an error, for an environment the team has that is not offered', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })

      const { statusCode, result } = await post(`${PAGE}/disable`, {
        environments: ['infradev']
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('title').text().trim()).toMatch(/^Error: /)
      expect(text($('.govuk-error-summary'))).toContain(
        'Choose environments from the list'
      )
      expect($('.govuk-error-summary a').attr('href')).toBe('#environments')
      expect(text($('#environments-error'))).toContain(
        'Choose environments from the list'
      )
    })

    test('shows the not-found page for an environment the team does not have', async () => {
      const { statusCode, result } = await post(`${PAGE}/disable`, {
        environments: ['moon']
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(load(result)('h1').text()).toBe('Environment not found')
    })
  })

  describe('the reason (Disable team)', () => {
    beforeEach(() => {
      mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })
    })

    test('says what happens, that the credentials keep working, and asks for a reason with a character count, a secondary button and Cancel', async () => {
      const { statusCode, result } = await get(
        `${PAGE}/disable/reason?environments=infradev`
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text()).toBe('Disable team')
      expect(text($('[data-testid="credentials-effect"]'))).toBe(
        'People in Flood Risk Team can view it but not change it, and cannot change anything in Development. The team is not told why.'
      )
      expect(text($('[data-testid="credentials-note"]'))).toBe(
        '! Warning Its credentials keep working.'
      )
      expect($('main').text()).not.toContain('To stop calls')
      expect($('main').text()).not.toMatch(/disable its credentials/i)
      expect($('main').text()).not.toMatch(/revoke/i)
      expect(
        $('textarea[name="reason"]').attr('data-maxlength') ??
          $('.govuk-character-count').attr('data-maxlength')
      ).toBe('500')
      expect($('input[name="formKey"]').val()).toMatch(UUID_V4)
      expect($('[data-testid="credentials-submit"]').attr('class')).toContain(
        'govuk-button--secondary'
      )
      expect(text($('[data-testid="credentials-submit"]'))).toBe('Disable team')
      expect($('[data-testid="credentials-cancel"]').attr('href')).toBe(PAGE)
      expect($('.govuk-back-link').attr('href')).toBe(
        `${PAGE}/disable?environments=infradev`
      )
    })

    test('says it of the team alone when no environment was ticked', async () => {
      const $ = load((await get(`${PAGE}/disable/reason`)).result)

      expect(text($('[data-testid="credentials-effect"]'))).toBe(
        'People in Flood Risk Team can view it but not change it. The team is not told why.'
      )
    })

    test('shows the not-found page for an unknown environment, and the choice again for one not offered', async () => {
      expect(
        (await get(`${PAGE}/disable/reason?environments=moon`)).statusCode
      ).toBe(statusCodes.notFound)

      mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })

      const { statusCode, result } = await get(
        `${PAGE}/disable/reason?environments=infradev`
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(text(load(result)('.govuk-error-summary'))).toContain(
        'Choose environments from the list'
      )
    })

    test.each([
      ['empty', '', 'Enter a reason'],
      ['blank', '   \r\n  ', 'Enter a reason'],
      [
        'over 500 characters',
        'a'.repeat(501),
        'Reason must be 500 characters or fewer'
      ]
    ])(
      'shows the error summary and an inline error, a title that starts "Error: ", the text kept and nothing changed, for a reason that is %s',
      async (_what, reason, message) => {
        const { statusCode, result } = await post(
          `${PAGE}/disable/reason?environments=infradev`,
          { reason, formKey: FORM_ID }
        )
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('title').text().trim()).toMatch(/^Error: /)
        expect(text($('.govuk-error-summary'))).toContain(message)
        expect($('.govuk-error-summary a').attr('href')).toBe('#reason')
        expect(text($('#reason-error'))).toContain(message)
        expect($('textarea[name="reason"]').text().trim()).toBe(reason.trim())
        expect($('input[name="formKey"]').val()).toBe(FORM_ID)
        expect(writes()).toEqual([])
      }
    )

    test('shows the choice again for an environment that is not offered, and the not-found page for an unknown one, and disables nothing', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })

      const refused = await post(
        `${PAGE}/disable/reason?environments=infradev`,
        {
          reason: 'Leaked',
          formKey: FORM_ID
        }
      )
      const $ = load(refused.result)

      expect(refused.statusCode).toBe(statusCodes.badRequest)
      expect($('title').text().trim()).toMatch(/^Error: /)
      expect(text($('.govuk-error-summary'))).toContain(
        'Choose environments from the list'
      )
      expect(
        (
          await post(`${PAGE}/disable/reason?environments=moon`, {
            reason: 'Leaked'
          })
        ).statusCode
      ).toBe(statusCodes.notFound)
      expect(writes()).toEqual([])
    })

    test('disables the team in one call with the reason, the environments and an Idempotency-Key, then goes to the confirmation', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: {
          team: {
            id: 'team-1',
            status: 'disabled',
            disabledEnvironments: ['infradev']
          }
        }
      })

      const response = await post(
        `${PAGE}/disable/reason?environments=infradev`,
        { reason: '  Suspected misuse  ', formKey: FORM_ID }
      )

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(
        `${PAGE}/disabled?environments=infradev`
      )
      expect(writes()).toEqual([
        {
          path: `${API}/disable`,
          body: { reason: 'Suspected misuse', environments: ['infradev'] },
          key: expect.stringMatching(UUID_V4)
        }
      ])
    })

    test('disables the team alone, with an empty list, when no environment was ticked', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: { team: { id: 'team-1', status: 'disabled' } }
      })

      const response = await post(`${PAGE}/disable/reason`, {
        reason: 'Investigating',
        formKey: FORM_ID
      })

      expect(response.headers.location).toBe(`${PAGE}/disabled`)
      expect(writes()[0].body).toEqual({
        reason: 'Investigating',
        environments: []
      })
    })

    test('sends the same key for the same form and reason, so a repeat changes nothing, and another for another reason or choice', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: { team: { id: 'team-1', status: 'disabled' } }
      })
      const send = (reason, query = '') =>
        post(`${PAGE}/disable/reason${query}`, { reason, formKey: FORM_ID })

      await send('Same reason')
      await send('Same reason')
      await send('Another reason')
      await send('Same reason', '?environments=infradev')

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

      const response = await post(`${PAGE}/disable/reason`, {
        reason: 'Mentions jo.smith@defra.gov.uk',
        formKey: FORM_ID
      })

      expect(response.headers.location).not.toContain('jo.smith')
      expect(JSON.stringify(logged)).not.toContain('jo.smith')
    })

    test('says a reason the backend will not take, with the text kept', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: answer(400, 'reason-too-long')
      })

      const { statusCode, result } = await post(`${PAGE}/disable/reason`, {
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

    test('shows the not-found page when the backend has no such environment', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: answer(404, 'environment-not-found')
      })

      const { statusCode, result } = await post(`${PAGE}/disable/reason`, {
        reason: 'Some reason',
        formKey: FORM_ID
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(load(result)('h1').text()).toBe('Environment not found')
    })

    test.each([
      ['fails', answer(502, 'upstream-unavailable')],
      [
        'refuses the key as used for another request',
        answer(409, 'idempotency-key-reused')
      ]
    ])(
      'says the team could not be disabled, with no success and a Try again that repeats it, when the backend %s',
      async (_what, refusal) => {
        mockApi(fetchMock, {
          [`GET ${API}`]: ACTIVE,
          [`POST ${API}/disable`]: refusal
        })

        const { statusCode, result } = await post(
          `${PAGE}/disable/reason?environments=infradev`,
          { reason: 'Some reason', formKey: FORM_ID }
        )
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badGateway)
        expect($('h1').text()).toBe('We could not disable Flood Risk Team')
        expect(result).not.toContain('Team disabled')
        expect($('[data-testid="credentials-retry"]').attr('href')).toBe(
          `${PAGE}/disable/reason?environments=infradev`
        )
        expect($('[data-testid="credentials-back"]').attr('href')).toBe(PAGE)
      }
    )

    test('lets the 403 of a person who lost the role through to the 403 page', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: ACTIVE,
        [`POST ${API}/disable`]: FORBIDDEN
      })

      const { statusCode } = await post(`${PAGE}/disable/reason`, {
        reason: 'Some reason',
        formKey: FORM_ID
      })

      expect(statusCode).toBe(statusCodes.forbidden)
    })
  })

  describe('the confirmation (Disable team)', () => {
    test('says Team disabled and that the credentials keep working, once the team shows it is disabled', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_BOTH })

      const { statusCode, result } = await get(
        `${PAGE}/disabled?environments=infradev`
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1')).toHaveLength(1)
      expect(text($('.govuk-panel__title'))).toBe('Team disabled')
      expect(text($('.govuk-panel__body'))).toBe('Development also disabled')
      expect(text($('[data-testid="credentials-effect"]'))).toBe(
        'Its credentials keep working.'
      )
      expect($('main').text()).not.toContain('To stop calls')
      expect($('main').text()).not.toMatch(/disable its credentials/i)
      expect($('main').text()).not.toMatch(/revoke/i)
      expect(text($('[data-testid="credentials-back"]'))).toBe(
        'Back to the team'
      )
    })

    test('says it for a team disabled alone, with nothing named in the panel', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_ALONE })

      const $ = load((await get(`${PAGE}/disabled`)).result)

      expect(text($('.govuk-panel__title'))).toBe('Team disabled')
      expect($('.govuk-panel__body')).toHaveLength(0)
    })

    test('goes back to the team when it is not disabled, or not in the environments named', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

      const active = await get(`${PAGE}/disabled`)

      expect(active.statusCode).toBe(statusCodes.seeOther)
      expect(active.headers.location).toBe(PAGE)

      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_ALONE })

      expect(
        (await get(`${PAGE}/disabled?environments=infradev`)).headers.location
      ).toBe(PAGE)
    })

    test('shows the not-found page for an environment the team does not have', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_ALONE })

      expect((await get(`${PAGE}/disabled?environments=moon`)).statusCode).toBe(
        statusCodes.notFound
      )
    })
  })

  describe('Enable team', () => {
    test('offers the disabled environments, all ticked, and says the team is enabled whatever is chosen', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_BOTH })

      const { statusCode, result } = await get(`${PAGE}/enable`)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text()).toBe('Enable team')
      expect(checkboxes($)).toEqual([
        { value: 'infradev', checked: true },
        { value: 'qa', checked: true }
      ])
      expect(text($('#environments-hint'))).toContain(
        'The team is enabled whatever you choose.'
      )
      expect($('textarea')).toHaveLength(0)
      expect(text($('[data-testid="credentials-submit"]'))).toBe('Enable team')
      expect($('main input[name="crumb"]')).toHaveLength(1)
    })

    test('offers only the disabled ones, and ticks what the address names', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })

      expect(checkboxes(load((await get(`${PAGE}/enable`)).result))).toEqual([
        { value: 'infradev', checked: true }
      ])

      mockApi(fetchMock, { [`GET ${API}`]: DISABLED_BOTH })

      expect(
        checkboxes(load((await get(`${PAGE}/enable?environments=qa`)).result))
      ).toEqual([
        { value: 'infradev', checked: false },
        { value: 'qa', checked: true }
      ])
    })

    test('says there is nothing to enable for a team that is not disabled with no environment disabled, and changes nothing', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

      const get$ = load((await get(`${PAGE}/enable`)).result)
      const posted = await post(`${PAGE}/enable`, {})

      expect(text(get$('[data-testid="nothing-to-do"]'))).toBe(
        'This team is not disabled, and none of its environments are.'
      )
      expect(get$('[data-testid="credentials-cancel"]').attr('href')).toBe(PAGE)
      expect(posted.statusCode).toBe(statusCodes.ok)
      expect(writes()).toEqual([])
    })

    test('says there is no environment to unlock for a team disabled alone, and still enables it', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: DISABLED_ALONE,
        [`POST ${API}/enable`]: { team: { id: 'team-1', status: 'active' } }
      })

      const $ = load((await get(`${PAGE}/enable`)).result)

      expect(text($('[data-testid="no-environments"]'))).toContain(
        'No environment is disabled.'
      )

      const response = await post(`${PAGE}/enable`, {})

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(writes()).toEqual([
        { path: `${API}/enable`, body: { environments: [] }, key: undefined }
      ])
    })

    test('lifts the team lock and unlocks the ticked environments with no reason and no key, then returns to the team with a success notification', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: DISABLED_BOTH,
        [`POST ${API}/enable`]: {
          team: { id: 'team-1', status: 'active', disabledEnvironments: ['qa'] }
        }
      })

      const response = await post(`${PAGE}/enable`, {
        environments: ['infradev']
      })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)
      expect(writes()).toEqual([
        {
          path: `${API}/enable`,
          body: { environments: ['infradev'] },
          key: undefined
        }
      ])

      mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })

      const $ = load((await follow(response)).result)

      expect(text($('[data-testid="team-notification"]'))).toContain(
        'Team enabled and Development unlocked. Test is still disabled.'
      )
      expect($('[data-testid="team-notification"]').attr('class')).toContain(
        'govuk-notification-banner--success'
      )
    })

    test('lifts the team lock even with nothing ticked, which leaves every environment locked', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: DISABLED_BOTH,
        [`POST ${API}/enable`]: { team: { id: 'team-1', status: 'active' } }
      })

      const response = await post(`${PAGE}/enable`, {})

      expect(writes()[0].body).toEqual({ environments: [] })

      mockApi(fetchMock, {
        [`GET ${API}`]: teamRead({
          ...DISABLED_BOTH.team,
          status: 'active'
        })
      })

      const $ = load((await follow(response)).result)

      expect(text($('[data-testid="team-notification"]'))).toContain(
        'Team enabled. Development and Test are still disabled.'
      )
    })

    describe('a team that is already enabled, with an environment still disabled', () => {
      beforeEach(() => {
        mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })
      })

      test('says the team is already enabled, rather than that it is enabled whatever is chosen', async () => {
        const $ = load((await get(`${PAGE}/enable`)).result)

        expect(text($('#environments-hint'))).toBe(
          'The team is already enabled. Tick the environments to unlock. Environments you do not tick stay disabled.'
        )
      })

      test('asks for at least one environment when none is ticked, shows no success, and changes nothing', async () => {
        const { statusCode, result } = await post(`${PAGE}/enable`, {})
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('title').text().trim()).toMatch(/^Error: /)
        expect(text($('.govuk-error-summary'))).toContain(
          'Choose at least one environment to unlock'
        )
        expect($('.govuk-error-summary a').attr('href')).toBe('#environments')
        expect(text($('#environments-error'))).toContain(
          'Choose at least one environment to unlock'
        )
        expect(checkboxes($)).toEqual([{ value: 'infradev', checked: false }])
        expect(writes()).toEqual([])
      })

      test('unlocks the environment that is ticked, with a banner that says so', async () => {
        mockApi(fetchMock, {
          [`GET ${API}`]: DEVELOPMENT_ONLY,
          [`POST ${API}/enable`]: {
            team: { id: 'team-1', status: 'active', disabledEnvironments: [] }
          }
        })

        const response = await post(`${PAGE}/enable`, {
          environments: ['infradev']
        })

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(writes()).toEqual([
          {
            path: `${API}/enable`,
            body: { environments: ['infradev'] },
            key: undefined
          }
        ])

        mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

        const $ = load((await follow(response)).result)

        const banner = text($('[data-testid="team-notification"]'))

        expect(banner).toContain('Development unlocked.')
        expect(banner).not.toContain('Team enabled')
      })
    })

    test('shows the choice again for an environment that is not disabled, and the not-found page for an unknown one, and changes nothing', async () => {
      mockApi(fetchMock, { [`GET ${API}`]: DEVELOPMENT_ONLY })

      const refused = await post(`${PAGE}/enable`, { environments: ['qa'] })

      expect(refused.statusCode).toBe(statusCodes.badRequest)
      expect(load(refused.result)('title').text().trim()).toMatch(/^Error: /)
      expect(
        (await post(`${PAGE}/enable`, { environments: ['moon'] })).statusCode
      ).toBe(statusCodes.notFound)
      expect(writes()).toEqual([])
    })

    test('says the team could not be enabled, with a Try again, when the backend fails, and does not say it was enabled', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: DISABLED_BOTH,
        [`POST ${API}/enable`]: answer(502, 'upstream-unavailable')
      })

      const { statusCode, result } = await post(`${PAGE}/enable`, {
        environments: ['infradev', 'qa']
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badGateway)
      expect($('h1').text()).toBe('We could not enable Flood Risk Team')
      expect($('[data-testid="credentials-retry"]').attr('href')).toBe(
        `${PAGE}/enable`
      )
    })

    test('lets a refusal it cannot put right through to the page that says so', async () => {
      mockApi(fetchMock, {
        [`GET ${API}`]: DISABLED_BOTH,
        [`POST ${API}/enable`]: answer(400, 'invalid-request')
      })

      const { statusCode } = await post(`${PAGE}/enable`, {
        environments: ['infradev']
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  test('needs the CSRF crumb on every POST', async () => {
    mockApi(fetchMock, { [`GET ${API}`]: ACTIVE })

    for (const path of ['disable', 'disable/reason', 'enable']) {
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

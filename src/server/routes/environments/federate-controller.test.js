import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  FEDERATE_URL,
  FEDERATIONS_PATH,
  PRINCIPAL_ID,
  dryRun,
  queued
} from '#/test-helpers/federation-helpers.js'
import {
  OVERVIEW_URL,
  INFRADEV_URL,
  TEAM_PATH,
  applicationsOf,
  detail,
  environmentsRead,
  federatedApplication,
  operationsAnswer
} from '#/test-helpers/environments-helpers.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
  sampleModel,
  sampleTeam,
  teamWithMembers
} from '#/test-helpers/team-connect-helpers.js'

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

const SERVICE_URL = `${FEDERATE_URL}/service`
const PRINCIPAL_URL = `${FEDERATE_URL}/principal-id`
const NAME_URL = `${FEDERATE_URL}/name`
const ENVIRONMENTS_URL = `${FEDERATE_URL}/environments`
const CHECK_URL = `${FEDERATE_URL}/check`
const PROGRESS_URL = `${FEDERATE_URL}/progress`
const CHECK_PATH = `${FEDERATIONS_PATH}/check`

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('the Federate journey', () => {
  let server
  let cookies
  const configured = config.get('teamEnvironments')

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('teamEnvironments', configured)
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    fetchMock.resetMocks()
    config.set('teamEnvironments', ['infradev', 'qa'])
    cookies = await signInViaOidc(server, fetchMock)
  })

  function backend({ role = 'admin', ...routes } = {}) {
    mockApi(fetchMock, {
      'GET /v1/teams': { items: [sampleTeam] },
      'GET /v1/models': { items: [sampleModel] },
      'GET /v1/credentials': { items: [] },
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${TEAM_PATH}/environments`]: environmentsRead(),
      [`GET ${TEAM_PATH}/environments/infradev`]: detail(),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      [`POST ${CHECK_PATH}`]: dryRun(),
      [`POST ${FEDERATIONS_PATH}`]: queued(),
      ...routes
    })
  }

  async function get(url) {
    const response = await server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
    })

    cookies = mergeCookies(cookies, response)

    return { response, $: load(response.result ?? '') }
  }

  async function post(url, payload = {}) {
    const response = await server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, ...payload }
    })

    cookies = mergeCookies(cookies, response)

    return { response, $: load(response.result ?? '') }
  }

  // The journey as far as a CDP service, and the dry run it makes.
  async function toCdpService(service = 'flood-api', start = '') {
    await post(`${FEDERATE_URL}${start}`, { host: 'cdp' })

    return post(SERVICE_URL, { service })
  }

  async function toAzureName(name = 'flood-reports') {
    await post(FEDERATE_URL, { host: 'azure' })
    await post(PRINCIPAL_URL, { principalId: PRINCIPAL_ID })

    return post(NAME_URL, { name })
  }

  function calls(method, path) {
    return fetchMock.mock.calls.filter(
      ([url, init]) => init?.method === method && new URL(url).pathname === path
    )
  }

  function bodyOf([, init]) {
    return JSON.parse(init.body)
  }

  describe('where the application runs', () => {
    test('asks one question, on CDP or on Azure, with a Back link to the overview (AC13, AC15)', async () => {
      backend()

      const { response, $ } = await get(FEDERATE_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, '[data-testid="app-heading-caption"]')).toBe(
        'Flood Risk Team'
      )
      expect(text($, 'legend h1')).toBe('Where does your application run?')
      expect($('title').text()).toContain('Where does your application run?')
      expect(
        $('input[name="host"]')
          .map((_, el) => $(el).val())
          .get()
      ).toEqual(['cdp', 'azure'])
      expect(text($, '.govuk-radios__hint')).toContain(
        'A CDP service, such as flood-api'
      )
      expect(text($, '.govuk-radios__hint')).toContain(
        'A user-assigned managed identity in the Defra tenant'
      )
      expect($('a.govuk-back-link').attr('href')).toBe(OVERVIEW_URL)
      expect($('main form input[name="crumb"]')).toHaveLength(1)
    })

    test('goes back to the environment page it started from', async () => {
      backend()

      const { $ } = await get(`${FEDERATE_URL}?environment=infradev`)

      expect($('a.govuk-back-link').attr('href')).toBe(INFRADEV_URL)
    })

    test('ignores a starting environment this instance does not offer', async () => {
      backend()

      const { $ } = await get(`${FEDERATE_URL}?environment=nowhere`)

      expect($('a.govuk-back-link').attr('href')).toBe(OVERVIEW_URL)
    })

    test('shows an error summary linked to the radios when nothing is chosen', async () => {
      backend()

      const { response, $ } = await post(FEDERATE_URL, {})

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect($('title').text()).toContain('Error:')
      expect(text($, '.govuk-error-summary')).toContain(
        'Select where your application runs'
      )
      expect($('.govuk-error-summary a').attr('href')).toBe('#host')
      expect(text($, '#host-error')).toContain(
        'Select where your application runs'
      )
    })

    test.each([
      ['cdp', SERVICE_URL],
      ['azure', PRINCIPAL_URL]
    ])('goes on to the %s question', async (host, next) => {
      backend()

      const { response } = await post(FEDERATE_URL, { host })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(next)
    })

    test('lets any member of the team federate', async () => {
      backend({ role: 'user' })

      expect((await get(FEDERATE_URL)).response.statusCode).toBe(statusCodes.ok)
    })

    test('is a 404 with nothing about the team for a person who is not a member', async () => {
      backend({
        [`GET ${TEAM_PATH}`]: reply(404, {
          code: 'error',
          message: 'Not found'
        })
      })

      const { response, $ } = await get(FEDERATE_URL)

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(text($, 'h1')).toBe('Team not found')
    })

    test('says it is unavailable when the backend fails', async () => {
      backend({
        [`GET ${TEAM_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const { response, $ } = await get(FEDERATE_URL)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text($, 'h1')).toBe('Applications are not available just now')
    })

    test('keeps what was answered when the same answer is given again', async () => {
      backend()

      await toCdpService('flood-api')
      const { response } = await post(FEDERATE_URL, { host: 'cdp' })
      const { $ } = await get(SERVICE_URL)

      expect(response.headers.location).toBe(SERVICE_URL)
      expect($('#service').attr('value')).toBe('flood-api')
    })

    test('starts the other host’s questions afresh when the answer changes', async () => {
      backend()

      await toCdpService('flood-api')
      await post(FEDERATE_URL, { host: 'azure' })
      const { response } = await get(SERVICE_URL)

      expect(response.headers.location).toBe(FEDERATE_URL)
    })
  })

  describe('the CDP service name', () => {
    test('sends a person with no journey back to the first question', async () => {
      backend()

      const { response } = await get(SERVICE_URL)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(FEDERATE_URL)
    })

    test('asks what the CDP service is called, with the rule in the hint (AC13)', async () => {
      backend()
      await post(FEDERATE_URL, { host: 'cdp' })

      const { response, $ } = await get(SERVICE_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, 'h1 label')).toBe('What is your CDP service called?')
      expect(text($, '#service-hint')).toBe(
        'Its repository name: lower-case letters, numbers and single hyphens, up to 32 characters.'
      )
      expect($('#service').attr('autocomplete')).toBe('off')
      expect($('a.govuk-back-link').attr('href')).toBe(FEDERATE_URL)
    })

    test('is not for a person who said the application runs on Azure', async () => {
      backend()
      await post(FEDERATE_URL, { host: 'azure' })

      const { response } = await get(SERVICE_URL)

      expect(response.headers.location).toBe(FEDERATE_URL)
    })

    test.each([
      ['', 'Enter your CDP service name'],
      [
        'Flood API',
        'The CDP service name must use only lower-case letters, numbers and single hyphens'
      ],
      [
        'flood--api',
        'The CDP service name must use only lower-case letters, numbers and single hyphens'
      ],
      ['x'.repeat(33), 'The CDP service name must be 32 characters or fewer']
    ])(
      'refuses “%s” with an error summary and an inline error, keeping what was typed (AC16)',
      async (service, message) => {
        backend()
        await post(FEDERATE_URL, { host: 'cdp' })

        const { response, $ } = await post(SERVICE_URL, { service })

        expect(response.statusCode).toBe(statusCodes.badRequest)
        expect($('title').text()).toContain('Error:')
        expect(text($, '.govuk-error-summary')).toContain(message)
        expect($('.govuk-error-summary a').attr('href')).toBe('#service')
        expect(text($, '#service-error')).toContain(message)
        expect($('#service').attr('value')).toBe(service)
      }
    )

    test('goes on to the environments with a valid name', async () => {
      backend()
      await post(FEDERATE_URL, { host: 'cdp' })

      const { response } = await post(SERVICE_URL, { service: 'flood-api' })

      expect(response.headers.location).toBe(ENVIRONMENTS_URL)
    })

    test('goes straight back to the check page when it was opened from there', async () => {
      backend()
      await toCdpService('flood-api')
      await get(ENVIRONMENTS_URL)
      await post(ENVIRONMENTS_URL, { environments: ['infradev'] })

      const { response } = await post(`${SERVICE_URL}?change=check`, {
        service: 'flood-api-v2'
      })

      expect(response.headers.location).toBe(CHECK_URL)
    })
  })

  describe('the Azure application', () => {
    test('asks for the managed identity’s principal ID, then a name for the application (AC15)', async () => {
      backend()
      await post(FEDERATE_URL, { host: 'azure' })

      const principal = await get(PRINCIPAL_URL)

      expect(text(principal.$, 'h1 label')).toBe(
        'What is the managed identity’s principal ID?'
      )
      expect(text(principal.$, '#principalId-hint')).toContain(
        'A system-assigned identity cannot be used.'
      )

      const saved = await post(PRINCIPAL_URL, { principalId: PRINCIPAL_ID })

      expect(saved.response.headers.location).toBe(NAME_URL)

      const name = await get(NAME_URL)

      expect(text(name.$, 'h1 label')).toBe(
        'What do you want to call this application?'
      )
      expect(name.$('a.govuk-back-link').attr('href')).toBe(PRINCIPAL_URL)
    })

    test('refuses a principal ID that is not a GUID', async () => {
      backend()
      await post(FEDERATE_URL, { host: 'azure' })

      const { response, $ } = await post(PRINCIPAL_URL, {
        principalId: 'not-a-guid'
      })

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(text($, '#principalId-error')).toContain(
        'The principal ID must be a GUID'
      )
      expect($('#principalId').attr('value')).toBe('not-a-guid')
    })

    test('refuses a name that is not lower-case letters, numbers and hyphens', async () => {
      backend()
      await post(FEDERATE_URL, { host: 'azure' })
      await post(PRINCIPAL_URL, { principalId: PRINCIPAL_ID })

      const { response, $ } = await post(NAME_URL, { name: 'Flood Reports' })

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect($('.govuk-error-summary a').attr('href')).toBe('#name')
    })

    test('goes on to the environments after the name', async () => {
      backend()

      const { response } = await toAzureName()

      expect(response.headers.location).toBe(ENVIRONMENTS_URL)
    })
  })

  describe('which environments', () => {
    test('asks the backend’s dry run about every available environment, once the application is named', async () => {
      backend()
      await toCdpService('flood-api')

      await get(ENVIRONMENTS_URL)

      expect(calls('POST', CHECK_PATH)).toHaveLength(1)
      expect(bodyOf(calls('POST', CHECK_PATH)[0])).toEqual({
        host: 'cdp',
        service: 'flood-api',
        environments: ['infradev', 'qa']
      })
    })

    test('sends a person whose application is not named back to the first question', async () => {
      backend()
      await post(FEDERATE_URL, { host: 'cdp' })

      const { response } = await get(ENVIRONMENTS_URL)

      expect(response.headers.location).toBe(FEDERATE_URL)
      expect(calls('POST', CHECK_PATH)).toHaveLength(0)
    })

    test('lists the environments with room as checkboxes, each saying which CDP environment it trusts, and ticks the one it started from (AC14)', async () => {
      backend()
      await toCdpService('flood-api', '?environment=infradev')

      const { response, $ } = await get(ENVIRONMENTS_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, 'legend h1')).toBe(
        'Which environments should trust flood-api?'
      )
      expect(
        $('input[name="environments"]')
          .map((_, el) => $(el).val())
          .get()
      ).toEqual(['infradev', 'qa'])
      expect($('input[value="infradev"]').attr('checked')).toBeDefined()
      expect($('input[value="qa"]').attr('checked')).toBeUndefined()
      expect(text($, '#environments-item-hint')).toBe(
        'Trusts flood-api in CDP’s dev environment'
      )
      expect(text($, '#environments-2-item-hint')).toBe(
        'Trusts flood-api in CDP’s test environment'
      )
      expect(text($, '#environments-hint')).toBe(
        'Only environments your team has set up, with room for another application, are listed.'
      )
      expect($('a.govuk-back-link').attr('href')).toBe(SERVICE_URL)
    })

    test('ticks nothing when the journey started from the overview', async () => {
      backend()
      await toCdpService('flood-api')

      const { $ } = await get(ENVIRONMENTS_URL)

      expect($('input[name="environments"][checked]')).toHaveLength(0)
    })

    test('does not list an environment whose registration is full or that is not set up, and says why in the hint (AC17)', async () => {
      config.set('teamEnvironments', ['infradev', 'qa', 'preprod'])
      backend({
        [`POST ${CHECK_PATH}`]: dryRun({
          qa: 'federation-limit-reached',
          preprod: 'environment-not-set-up',
          infradev: null
        })
      })
      await toCdpService('flood-api')

      const { response } = await get(ENVIRONMENTS_URL)

      // Only Infradev is left offered, and it takes the application.
      expect(response.headers.location).toBe(CHECK_URL)
    })

    test('lists the environments left when some are full, and not the full one', async () => {
      config.set('teamEnvironments', ['infradev', 'qa', 'preprod'])
      backend({
        [`POST ${CHECK_PATH}`]: dryRun({ qa: 'federation-limit-reached' })
      })
      await toCdpService('flood-api')

      const { $ } = await get(ENVIRONMENTS_URL)

      expect(
        $('input[name="environments"]')
          .map((_, el) => $(el).val())
          .get()
      ).toEqual(['infradev', 'preprod'])
      expect(text($, '#environments-hint')).toContain(
        'room for another application'
      )
    })

    test('skips the question when only one environment has room and takes the application, and the check page says so (AC17)', async () => {
      backend({
        [`POST ${CHECK_PATH}`]: dryRun({ qa: 'federation-limit-reached' })
      })
      await toCdpService('flood-api')

      const skipped = await get(ENVIRONMENTS_URL)
      const check = await get(CHECK_URL)

      expect(skipped.response.statusCode).toBe(statusCodes.seeOther)
      expect(skipped.response.headers.location).toBe(CHECK_URL)
      expect(check.response.statusCode).toBe(statusCodes.ok)
      expect(check.$('#change-environments')).toHaveLength(0)
      expect(check.$('a.govuk-back-link').attr('href')).toBe(SERVICE_URL)
    })

    test('says why when the only environment with room refuses the application, naming it and never another team (AC16)', async () => {
      backend({
        [`POST ${CHECK_PATH}`]: dryRun({
          qa: 'federation-limit-reached',
          infradev: 'federation-trusted-elsewhere'
        })
      })
      await toCdpService('flood-api')

      const { response, $ } = await get(ENVIRONMENTS_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, '.govuk-error-summary')).toContain(
        'Infradev: another team already uses flood-api there'
      )
      expect($('.govuk-error-summary a').attr('href')).toBe('#environments')
    })

    test('says there is nowhere to federate when no environment has room', async () => {
      backend({
        [`POST ${CHECK_PATH}`]: dryRun({
          infradev: 'federation-limit-reached',
          qa: 'environment-not-set-up'
        })
      })
      await toCdpService('flood-api')

      const { response, $ } = await get(ENVIRONMENTS_URL)

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, 'h1')).toBe(
        'flood-api cannot get a passwordless credential anywhere just now'
      )
    })

    test('asks for at least one environment', async () => {
      backend()
      await toCdpService('flood-api')

      const { response, $ } = await post(ENVIRONMENTS_URL, {})

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(text($, '.govuk-error-summary')).toContain(
        'Select at least one environment'
      )
      expect(text($, '#environments-error')).toContain(
        'Select at least one environment'
      )
    })

    test('refuses an environment that is not an environment code, linking to the first checkbox', async () => {
      backend()
      await toCdpService('flood-api')

      const { response, $ } = await post(ENVIRONMENTS_URL, {
        environments: ['Not An Environment']
      })

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect($('.govuk-error-summary a').attr('href')).toBe('#environments')
      expect(text($, '#environments-error')).toContain(
        'Select environments from the list'
      )
    })

    test('refuses an environment the page did not offer', async () => {
      backend()
      await toCdpService('flood-api')

      const { response, $ } = await post(ENVIRONMENTS_URL, {
        environments: ['prod']
      })

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(text($, '.govuk-error-summary')).toContain(
        'Select environments from the list'
      )
    })

    test.each([
      [
        'federation-exists',
        'QA: your team already has a passwordless credential for flood-api there'
      ],
      [
        'federation-trusted-elsewhere',
        'QA: another team already uses flood-api there'
      ]
    ])(
      'refuses an environment where %s, naming the environment, with nothing queued (AC16)',
      async (code, message) => {
        backend({ [`POST ${CHECK_PATH}`]: dryRun({ qa: code }) })
        await toCdpService('flood-api')

        const { response, $ } = await post(ENVIRONMENTS_URL, {
          environments: ['infradev', 'qa']
        })

        expect(response.statusCode).toBe(statusCodes.badRequest)
        expect(text($, '.govuk-error-summary')).toContain(message)
        expect(text($, '#environments-error')).toContain(message)
        expect($('input[value="infradev"]').attr('checked')).toBeDefined()
        expect(calls('POST', FEDERATIONS_PATH)).toHaveLength(0)
      }
    )

    test('keeps the choice and goes on to check it', async () => {
      backend()
      await toCdpService('flood-api')

      const { response } = await post(ENVIRONMENTS_URL, {
        environments: ['infradev', 'qa']
      })
      const { $ } = await get(ENVIRONMENTS_URL)

      expect(response.headers.location).toBe(CHECK_URL)
      expect(
        $('input[name="environments"][checked]')
          .map((_, el) => $(el).val())
          .get()
      ).toEqual(['infradev', 'qa'])
    })

    test('says it cannot check just now when the backend fails', async () => {
      backend({
        [`POST ${CHECK_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })
      await toCdpService('flood-api')

      const { response, $ } = await get(ENVIRONMENTS_URL)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text($, 'h1')).toBe('Applications are not available just now')
    })
  })

  describe('check your answers', () => {
    async function toCheck(environments = ['infradev', 'qa']) {
      await toCdpService('flood-api')
      await post(ENVIRONMENTS_URL, { environments })

      return get(CHECK_URL)
    }

    test('sends a person with no answers back to the first question', async () => {
      backend()

      const { response } = await get(CHECK_URL)

      expect(response.headers.location).toBe(FEDERATE_URL)
    })

    test('lists each answer with Change, naming each environment and the CDP environment it trusts (AC13)', async () => {
      backend()

      const { response, $ } = await toCheck()
      const rows = $('.govuk-summary-list__row')

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, 'h1')).toBe('Check your answers')
      expect(text($, rows.eq(0))).toContain('Runs on CDP')
      expect(text($, rows.eq(1))).toContain('CDP service flood-api')
      expect(
        rows
          .eq(2)
          .find('p')
          .map((_, el) => $(el).text())
          .get()
      ).toEqual([
        'Infradev, which trusts CDP’s dev environment',
        'QA, which trusts CDP’s test environment'
      ])
      expect(text($, rows.eq(2).find('dt'))).toBe('Environments')
      expect(
        $('.govuk-summary-list__actions a')
          .map((_, el) => $(el).attr('href'))
          .get()
      ).toEqual([
        `${FEDERATE_URL}?change=check`,
        `${SERVICE_URL}?change=check`,
        `${ENVIRONMENTS_URL}?change=check`
      ])
      expect(text($, '#change-service .govuk-visually-hidden')).toBe(
        'the CDP service'
      )
    })

    test('says the application gets the team’s access to every model in each environment, and names the button for it', async () => {
      backend()

      const { $ } = await toCheck()

      expect(text($, 'main h2')).toBe(
        'Now create a passwordless credential for flood-api'
      )
      expect(text($, 'main')).toContain(
        'flood-api will get Flood Risk Team’s access to every model in Infradev and QA.'
      )
      expect(text($, 'main form button')).toBe('Create Passwordless Credential')
    })

    test('lists an Azure application by its principal ID and name', async () => {
      backend()
      await toAzureName()
      await post(ENVIRONMENTS_URL, { environments: ['infradev'] })

      const { $ } = await get(CHECK_URL)

      expect(text($, '.govuk-summary-list')).toContain(
        `Principal ID ${PRINCIPAL_ID}`
      )
      expect(text($, '.govuk-summary-list')).toContain('Name flood-reports')
      expect(text($, 'main form button')).toBe('Create Passwordless Credential')
    })

    test('keeps the same key for the same answers and gives different answers another (AC12)', async () => {
      backend()
      const first = await toCheck(['infradev'])
      const keyOf = ($) => $('input[name="key"]').attr('value')

      await post(ENVIRONMENTS_URL, { environments: ['infradev'] })
      const again = await get(CHECK_URL)
      await post(ENVIRONMENTS_URL, { environments: ['infradev', 'qa'] })
      const changed = await get(CHECK_URL)

      expect(keyOf(first.$)).toMatch(/^[0-9a-f-]{36}$/)
      expect(keyOf(again.$)).toBe(keyOf(first.$))
      expect(keyOf(changed.$)).not.toBe(keyOf(first.$))
    })

    test('makes one request for every environment chosen, with the key shown, and follows its progress (AC13, AC14, AC12)', async () => {
      backend()
      const { $ } = await toCheck(['infradev', 'qa'])
      const key = $('input[name="key"]').attr('value')

      const { response } = await post(CHECK_URL, { key })
      const [call] = calls('POST', FEDERATIONS_PATH)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PROGRESS_URL)
      expect(calls('POST', FEDERATIONS_PATH)).toHaveLength(1)
      expect(bodyOf(call)).toEqual({
        host: 'cdp',
        service: 'flood-api',
        environments: ['infradev', 'qa']
      })
      expect(call[1].headers['idempotency-key']).toBe(key)
    })

    test('sends an Azure application with its principal ID and name, and no other identity (AC15)', async () => {
      backend()
      await toAzureName()
      await post(ENVIRONMENTS_URL, { environments: ['infradev'] })
      const { $ } = await get(CHECK_URL)

      await post(CHECK_URL, { key: $('input[name="key"]').attr('value') })

      expect(bodyOf(calls('POST', FEDERATIONS_PATH)[0])).toEqual({
        host: 'azure',
        principalId: PRINCIPAL_ID,
        name: 'flood-reports',
        environments: ['infradev']
      })
    })

    test('refuses a confirmation of answers that changed in another window, and queues nothing', async () => {
      backend()
      const { $ } = await toCheck(['infradev'])
      const key = $('input[name="key"]').attr('value')

      await post(ENVIRONMENTS_URL, { environments: ['infradev', 'qa'] })
      const { response, $: page } = await post(CHECK_URL, { key })

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text(page, '.govuk-error-summary')).toContain(
        'Your answers changed in another window'
      )
      expect(calls('POST', FEDERATIONS_PATH)).toHaveLength(0)
    })

    test('gives the check page again for a key that is not text, and queues nothing', async () => {
      backend()
      await toCheck(['infradev'])

      const { response, $ } = await post(CHECK_URL, { key: ['a', 'b'] })

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(text($, '.govuk-error-summary')).toContain(
        'We could not read your answers'
      )
      expect(calls('POST', FEDERATIONS_PATH)).toHaveLength(0)
    })

    test('says which environment refused it when the backend refuses at confirmation, and nothing is queued (AC16)', async () => {
      backend({
        [`POST ${FEDERATIONS_PATH}`]: reply(409, {
          code: 'federation-refused',
          message: 'Refused',
          environments: [{ environment: 'qa', code: 'federation-exists' }]
        })
      })
      const { $ } = await toCheck(['infradev', 'qa'])

      const { response, $: page } = await post(CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text(page, '.govuk-error-summary')).toContain(
        'QA: your team already has a passwordless credential for flood-api there'
      )
      expect(page('input[value="infradev"]').attr('checked')).toBeDefined()
    })

    test('starts again when the backend says the key was used for other answers', async () => {
      backend({
        [`POST ${FEDERATIONS_PATH}`]: reply(409, {
          code: 'idempotency-key-reused',
          message: 'Used'
        })
      })
      const { $ } = await toCheck(['infradev'])

      const { response, $: page } = await post(CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text(page, 'h1')).toBe('Check your answers again')
      expect((await get(CHECK_URL)).response.headers.location).toBe(
        FEDERATE_URL
      )
    })

    test('keeps the answers and says so when the backend fails, so the same request can be tried again', async () => {
      backend({
        [`POST ${FEDERATIONS_PATH}`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })
      const { $ } = await toCheck(['infradev'])
      const key = $('input[name="key"]').attr('value')

      const { response, $: page } = await post(CHECK_URL, { key })

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(page, '.govuk-error-summary')).toContain(
        'We could not make this change just now'
      )
      expect(page('input[name="key"]').attr('value')).toBe(key)
    })

    test('is a 404 when the backend says the team is not the person’s', async () => {
      backend({
        [`POST ${FEDERATIONS_PATH}`]: reply(404, {
          code: 'error',
          message: 'Not found'
        })
      })
      const { $ } = await toCheck(['infradev'])

      const { response } = await post(CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(response.statusCode).toBe(statusCodes.notFound)
    })

    test('lets a Member federate (any member can, the backend decides)', async () => {
      backend({ role: 'user' })
      const { $ } = await toCheck(['infradev'])

      const { response } = await post(CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(response.headers.location).toBe(PROGRESS_URL)
    })
  })

  describe('a person who is not a member of the team', () => {
    const notMember = {
      [`GET ${TEAM_PATH}`]: reply(404, { code: 'error', message: 'Not found' })
    }

    test.each([
      ['GET', FEDERATE_URL, undefined],
      ['GET', SERVICE_URL, undefined],
      ['GET', PRINCIPAL_URL, undefined],
      ['GET', NAME_URL, undefined],
      ['GET', ENVIRONMENTS_URL, undefined],
      ['GET', CHECK_URL, undefined],
      ['GET', PROGRESS_URL, undefined],
      ['POST', FEDERATE_URL, { host: 'cdp' }],
      ['POST', SERVICE_URL, { service: 'flood-api' }],
      ['POST', PRINCIPAL_URL, { principalId: PRINCIPAL_ID }],
      ['POST', NAME_URL, { name: 'flood-reports' }],
      ['POST', ENVIRONMENTS_URL, { environments: ['infradev'] }],
      ['POST', CHECK_URL, { key: 'k' }],
      // An answer that fails validation is still the same 404.
      ['POST', FEDERATE_URL, {}],
      ['POST', SERVICE_URL, { service: '' }],
      ['POST', PRINCIPAL_URL, { principalId: '' }],
      ['POST', NAME_URL, { name: '' }],
      ['POST', ENVIRONMENTS_URL, {}],
      ['POST', CHECK_URL, { key: ['a', 'b'] }]
    ])(
      'gets a 404 with nothing about the team for %s %s %j (AC2)',
      async (method, url, payload) => {
        backend(notMember)

        const send = method === 'GET' ? get(url) : post(url, payload)
        const { response, $ } = await send

        expect(response.statusCode).toBe(statusCodes.notFound)
        expect(text($, 'h1')).toBe('Team not found')
        expect(calls('POST', FEDERATIONS_PATH)).toHaveLength(0)
        expect(calls('POST', CHECK_PATH)).toHaveLength(0)
      }
    )

    test('is an error, not a page, when the backend answers a team read in a way the page does not know', async () => {
      backend({ [`GET ${TEAM_PATH}`]: reply(400, { code: 'something-new' }) })

      const { response } = await get(FEDERATE_URL)

      expect(response.statusCode).toBe(statusCodes.internalServerError)
    })
  })

  describe('a question reached without its journey', () => {
    test.each([
      ['a valid answer', SERVICE_URL, { service: 'flood-api' }],
      ['an invalid answer', SERVICE_URL, { service: '' }],
      ['a valid name', NAME_URL, { name: 'flood-reports' }]
    ])(
      'sends %s to %s back to the first question',
      async (_name, url, payload) => {
        backend()

        const { response } = await post(url, payload)

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(FEDERATE_URL)
      }
    )

    test('sends a confirmation with no answers, and a malformed one, back to the first question', async () => {
      backend()

      const valid = await post(CHECK_URL, { key: 'k' })
      const malformed = await post(CHECK_URL, { key: ['a', 'b'] })

      expect(valid.response.headers.location).toBe(FEDERATE_URL)
      expect(malformed.response.headers.location).toBe(FEDERATE_URL)
      expect(calls('POST', FEDERATIONS_PATH)).toHaveLength(0)
    })

    test('asks the first question afresh, ticking nothing, after a change to an application was started', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          applications: applicationsOf([federatedApplication()])
        })
      })

      await get(`${INFRADEV_URL}/applications/app-1/change`)
      const { $ } = await get(FEDERATE_URL)

      expect($('input[name="host"][checked]')).toHaveLength(0)
    })
  })

  describe('the questions the journey asks again', () => {
    test('goes back to the check page from the environments when it was opened from there', async () => {
      backend()
      await toCdpService('flood-api')
      await post(ENVIRONMENTS_URL, { environments: ['infradev', 'qa'] })

      const { $ } = await get(`${ENVIRONMENTS_URL}?change=check`)

      expect($('a.govuk-back-link').attr('href')).toBe(CHECK_URL)
      expect(
        $('input[name="environments"][checked]')
          .map((_, el) => $(el).val())
          .get()
      ).toEqual(['infradev', 'qa'])
    })

    test('says an Azure application is trusted from the Defra tenant, not by a CDP environment', async () => {
      backend()
      await toAzureName()

      const { $ } = await get(ENVIRONMENTS_URL)

      expect(text($, '#environments-item-hint')).toBe(
        'Trusts flood-reports from the Defra tenant'
      )
    })

    test('says it is not found when the backend does not know the team at the dry run', async () => {
      backend({ [`POST ${CHECK_PATH}`]: reply(404, { code: 'error' }) })
      await toCdpService('flood-api')

      const { response } = await get(ENVIRONMENTS_URL)

      expect(response.statusCode).toBe(statusCodes.notFound)
    })

    test('is an error when the dry run refuses in a way the page does not know', async () => {
      backend({ [`POST ${CHECK_PATH}`]: reply(400, { code: 'something-new' }) })
      await toCdpService('flood-api')

      const { response } = await get(ENVIRONMENTS_URL)

      expect(response.statusCode).toBe(statusCodes.internalServerError)
    })
  })

  describe('a confirmation the backend answers in another way', () => {
    async function confirmWith(answer) {
      backend({ [`POST ${FEDERATIONS_PATH}`]: answer })
      await toCdpService('flood-api')
      await post(ENVIRONMENTS_URL, { environments: ['infradev', 'qa'] })
      const { $ } = await get(CHECK_URL)

      return post(CHECK_URL, { key: $('input[name="key"]').attr('value') })
    }

    test('is a 404 for an environment the backend says is not available', async () => {
      const { response, $ } = await confirmWith(
        reply(404, { code: 'environment-not-available' })
      )

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(text($, 'h1')).toBe('Environment not found')
    })

    test('is an error when the backend refuses without saying which environments, so it is not hidden', async () => {
      const { response } = await confirmWith(
        reply(409, { code: 'federation-refused', message: 'Refused' })
      )

      expect(response.statusCode).toBe(statusCodes.internalServerError)
    })

    test('says it cannot check just now when the environments cannot be read again after a refusal', async () => {
      const { response } = await confirmWith(
        reply(409, {
          code: 'federation-refused',
          message: 'Refused',
          environments: [{ environment: 'qa', code: 'federation-exists' }]
        })
      )

      expect(response.statusCode).toBe(statusCodes.conflict)

      backend({
        [`POST ${FEDERATIONS_PATH}`]: reply(409, {
          code: 'federation-refused',
          environments: [{ environment: 'qa', code: 'federation-exists' }]
        }),
        [`POST ${CHECK_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })
      const { $ } = await get(CHECK_URL)
      const again = await post(CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(again.response.statusCode).toBe(statusCodes.serviceUnavailable)
    })

    test('is an error for a refusal the page does not know, so it is not hidden', async () => {
      const { response } = await confirmWith(
        reply(409, { code: 'something-new', message: 'New' })
      )

      expect(response.statusCode).toBe(statusCodes.internalServerError)
    })

    test('says a Member cannot, when the backend refuses with admin-required', async () => {
      const { response, $ } = await confirmWith(
        reply(403, { code: 'admin-required', message: 'No' })
      )

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(text($, 'h1')).toBe('You cannot change this application')
    })
  })
})

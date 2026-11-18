import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  FEDERATE_URL,
  FEDERATIONS_PATH,
  dryRun
} from '#/test-helpers/federation-helpers.js'
import {
  INFRADEV_URL,
  OVERVIEW_URL,
  TEAM_PATH,
  applicationsOf,
  clientSecretItem,
  clientSecretsOf,
  detail,
  environmentsRead,
  federatedApplication,
  operationsAnswer,
  summary
} from '#/test-helpers/environments-helpers.js'
import {
  cookieHeader,
  mergeCookies,
  signInViaOidc
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

const HEADING = 'Credentials are disabled'
const TOP_ACTIONS = '[data-testid="page-actions"]'
const CREDENTIALS_BANNER = '[data-testid="credentials-disabled-banner"]'
const APPLICATION_URL = `${INFRADEV_URL}/applications/app-1`

function text(scope, selector) {
  const matches =
    typeof scope === 'function' ? scope(selector) : scope.find(selector)

  return matches.text().replace(/\s+/g, ' ').trim()
}

describe('#environments with the team’s credentials disabled', () => {
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
    config.set('teamEnvironments', ['infradev'])
    cookies = await signInViaOidc(server, fetchMock)
  })

  function backend({ role = 'admin', environment = {}, ...routes } = {}) {
    mockApi(fetchMock, {
      'GET /v1/teams': { items: [sampleTeam] },
      'GET /v1/models': { items: [sampleModel] },
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${TEAM_PATH}/environments`]: environmentsRead([
        summary({ credentialsDisabled: true })
      ]),
      [`GET ${TEAM_PATH}/environments/infradev`]: detail({
        credentialsDisabled: true,
        clientSecrets: clientSecretsOf([clientSecretItem()]),
        applications: applicationsOf([federatedApplication()]),
        ...environment
      }),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      [`GET ${TEAM_PATH}/status-changes`]: { items: [] },
      [`POST ${FEDERATIONS_PATH}/check`]: dryRun(),
      ...routes
    })
  }

  async function request(method, url, payload) {
    const response = await server.inject({
      method,
      url,
      headers: { cookie: cookieHeader(cookies) },
      ...(payload ? { payload: { crumb: cookies.crumb, ...payload } } : {})
    })

    cookies = mergeCookies(cookies, response)

    return { response, $: load(response.result ?? '') }
  }

  const get = (url) => request('GET', url)
  const post = (url, payload = {}) => request('POST', url, payload)

  function writes() {
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        url.includes('/v1/') &&
        !url.includes('/v1/users/me') &&
        !url.endsWith('/federations/check') &&
        init?.method &&
        init.method !== 'GET'
    )
  }

  describe('an environment’s page', () => {
    test('says credentials are disabled, leaves the environment Available and does not say why', async () => {
      backend()

      const { response, $ } = await get(INFRADEV_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, '[data-testid="environment-tag"]')).toBe('Available')
      expect(text($, CREDENTIALS_BANNER)).toContain(HEADING)
      expect(text($, CREDENTIALS_BANNER)).not.toMatch(/reason|because/i)
      expect($('[data-testid="team-lock-banner"]')).toHaveLength(0)
    })

    test('greys add, view, rotate, Federate and Change, and keeps Revoke and Remove open', async () => {
      backend()

      const { $ } = await get(INFRADEV_URL)

      expect($('a[href$="/view"], a[href$="/rotate"]')).toHaveLength(0)
      expect(text($, '[data-testid="client-secret-view-locked"]')).toContain(
        'View'
      )
      expect(text($, '[data-testid="client-secret-rotate-locked"]')).toContain(
        'Rotate'
      )
      expect(
        $('[data-testid="client-secret-row"] a[href$="/revoke"]')
      ).toHaveLength(1)
      expect($('a[data-testid="add-client-secret"]')).toHaveLength(0)
      expect(
        $('button[data-testid="add-client-secret"]').attr('disabled')
      ).toBeDefined()
      expect(
        $(
          '[data-testid="section-applications"] button[data-testid="federate-an-application"]'
        ).attr('disabled')
      ).toBeDefined()
      expect($('a[data-testid="application-change"]')).toHaveLength(0)
      expect($('[data-testid="application-change-locked"]')).toHaveLength(1)
      expect($('a[data-testid="application-remove"]').attr('href')).toBe(
        `${APPLICATION_URL}/remove`
      )
    })

    test('puts the greyed Change before the Remove link', async () => {
      backend()

      const { $ } = await get(INFRADEV_URL)
      const actions = $('[data-testid="application-row"] .app-button-group')
        .children()
        .map((_, element) => $(element).attr('data-testid'))
        .get()

      expect(actions).toEqual([
        'application-change-locked',
        'application-remove'
      ])
    })

    test('leaves models and limits open', async () => {
      backend()

      const { $ } = await get(INFRADEV_URL)

      expect($('a[data-testid="deploy-a-model"]')).toHaveLength(1)
      expect($('a[data-testid="change-limits"]')).toHaveLength(1)
    })

    test('shows nothing of it while credentials are enabled', async () => {
      backend({ environment: { credentialsDisabled: false } })

      const { $ } = await get(INFRADEV_URL)

      expect($(CREDENTIALS_BANNER)).toHaveLength(0)
      expect($('a[href$="/view"]')).toHaveLength(1)
      expect($('a[data-testid="application-change"]')).toHaveLength(1)
    })
  })

  describe('the overview', () => {
    test('greys Create Passwordless Credential when every environment with room has its credentials disabled', async () => {
      backend()

      const { $ } = await get(OVERVIEW_URL)
      const federate = $(
        `${TOP_ACTIONS} [data-testid="federate-an-application"]`
      )

      expect(federate.is('button')).toBe(true)
      expect(federate.attr('disabled')).toBeDefined()
    })
  })

  describe('an action on an application', () => {
    test('shows Change as the Credentials are disabled page, with a link back, and writes nothing', async () => {
      backend()

      const { response, $ } = await get(`${APPLICATION_URL}/change`)

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, 'h1')).toBe(HEADING)
      expect($(`main a[href="${INFRADEV_URL}"]`)).toHaveLength(1)
      expect(writes()).toEqual([])
    })

    test('still shows Remove, and removes', async () => {
      backend({
        [`DELETE ${TEAM_PATH}/environments/infradev/federations/app-1`]: reply(
          202,
          {}
        )
      })

      const asked = await get(`${APPLICATION_URL}/remove`)

      expect(asked.response.statusCode).toBe(statusCodes.ok)

      const { response } = await post(`${APPLICATION_URL}/remove`)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(writes()).toHaveLength(1)
    })
  })

  describe('the Federate journey', () => {
    test('names the environment in words, as an error on the environments question, when the backend refuses it on confirming', async () => {
      backend({
        [`POST ${FEDERATIONS_PATH}`]: reply(409, {
          statusCode: 409,
          code: 'federation-refused',
          message: 'Refused',
          environments: [
            { environment: 'infradev', code: 'credentials-disabled' }
          ]
        })
      })
      await post(FEDERATE_URL, { host: 'cdp' })
      await post(`${FEDERATE_URL}/service`, { service: 'flood-api' })
      await get(`${FEDERATE_URL}/environments`)
      await post(`${FEDERATE_URL}/environments`, {
        environments: ['infradev']
      })

      const key = (await get(`${FEDERATE_URL}/check`))
        .$('input[name="key"]')
        .attr('value')
      const { response, $ } = await post(`${FEDERATE_URL}/check`, { key })

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, '.govuk-error-summary')).toContain(
        'Infradev: credentials are disabled, so you cannot create a passwordless credential there'
      )
    })
  })
})

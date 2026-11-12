import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  FEDERATE_URL,
  PRINCIPAL_ID
} from '#/test-helpers/federation-helpers.js'
import {
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

const ENVIRONMENT_PATH = `${TEAM_PATH}/environments/infradev`
const APPLICATION_PATH = `${ENVIRONMENT_PATH}/federations/app-1`
const CHANGE_URL = `${INFRADEV_URL}/applications/app-1/change`
const REMOVE_URL = `${INFRADEV_URL}/applications/app-1/remove`
const SERVICE_URL = `${FEDERATE_URL}/service`
const PRINCIPAL_URL = `${FEDERATE_URL}/principal-id`
const NAME_URL = `${FEDERATE_URL}/name`
const CHECK_URL = `${FEDERATE_URL}/check`

const AZURE_APPLICATION = federatedApplication({
  id: 'app-1',
  name: 'flood-reports',
  host: 'azure',
  service: undefined,
  principalId: PRINCIPAL_ID
})

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('changing and removing an application', () => {
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

  function backend({ role = 'admin', applications, ...routes } = {}) {
    mockApi(fetchMock, {
      'GET /v1/teams': { items: [sampleTeam] },
      'GET /v1/models': { items: [sampleModel] },
      'GET /v1/credentials': { items: [] },
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${TEAM_PATH}/environments`]: environmentsRead(),
      [`GET ${ENVIRONMENT_PATH}`]: detail({
        applications: applicationsOf(applications ?? [federatedApplication()])
      }),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      ...routes
    })
  }

  async function send(method, url, payload) {
    const response = await server.inject({
      method,
      url,
      headers: { cookie: cookieHeader(cookies) },
      ...(payload && { payload: { crumb: cookies.crumb, ...payload } })
    })

    cookies = mergeCookies(cookies, response)

    return { response, $: load(response.result ?? '') }
  }

  function calls(method, path) {
    return fetchMock.mock.calls.filter(
      ([url, init]) => init?.method === method && new URL(url).pathname === path
    )
  }

  describe('Change', () => {
    test('asks the CDP service question again with what the application has now, naming the application and its environment (AC13)', async () => {
      backend()

      const start = await send('GET', CHANGE_URL)
      const { response, $ } = await send('GET', SERVICE_URL)

      expect(start.response.statusCode).toBe(statusCodes.seeOther)
      expect(start.response.headers.location).toBe(SERVICE_URL)
      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, 'h1 label')).toBe('What is your CDP service called?')
      expect($('#service').attr('value')).toBe('flood-api')
      expect(text($, '[data-testid="app-heading-caption"]')).toBe(
        'Flood Risk Team · flood-api in Infradev'
      )
      expect($('a.govuk-back-link').attr('href')).toBe(INFRADEV_URL)
    })

    test('goes from the new service to the check page, which asks nothing about environments, and changes only that application (AC16)', async () => {
      backend({
        [`PATCH ${APPLICATION_PATH}`]: reply(202, {
          federation: federatedApplication({ status: 'setting-up' }),
          operationId: 'op-change'
        })
      })

      await send('GET', CHANGE_URL)
      const saved = await send('POST', SERVICE_URL, { service: 'flood-api-v2' })
      const check = await send('GET', CHECK_URL)

      expect(saved.response.headers.location).toBe(CHECK_URL)
      expect(text(check.$, 'h1')).toBe('Check your answers')
      expect(text(check.$, '.govuk-summary-list')).toContain(
        'Environment Infradev'
      )
      expect(text(check.$, '.govuk-summary-list')).toContain(
        'CDP service flood-api-v2'
      )
      expect(check.$('#change-environments')).toHaveLength(0)
      expect(text(check.$, 'main h2')).toBe('Now change flood-api')
      expect(text(check.$, 'main form button')).toBe('Change flood-api')
      expect(check.$('a.govuk-back-link').attr('href')).toBe(SERVICE_URL)

      const key = check.$('input[name="key"]').attr('value')
      const confirmed = await send('POST', CHECK_URL, { key })
      const [call] = calls('PATCH', APPLICATION_PATH)

      expect(confirmed.response.headers.location).toBe(INFRADEV_URL)
      expect(JSON.parse(call[1].body)).toEqual({ service: 'flood-api-v2' })
      expect(call[1].headers['idempotency-key']).toBe(key)
    })

    test('says on the environment page that the application is being changed', async () => {
      backend({
        [`PATCH ${APPLICATION_PATH}`]: reply(202, {
          federation: federatedApplication({ status: 'setting-up' }),
          operationId: 'op-change'
        })
      })
      await send('GET', CHANGE_URL)
      await send('POST', SERVICE_URL, { service: 'flood-api-v2' })
      const { $ } = await send('GET', CHECK_URL)
      await send('POST', CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      const page = await send('GET', INFRADEV_URL)

      expect(text(page.$, '[data-testid="team-notification"]')).toContain(
        'flood-api is being changed in Infradev'
      )
    })

    test('changes an Azure application by its principal ID and then its name', async () => {
      backend({
        applications: [AZURE_APPLICATION],
        [`PATCH ${APPLICATION_PATH}`]: reply(202, {
          federation: AZURE_APPLICATION,
          operationId: 'op-change'
        })
      })
      const otherId = '22222222-2222-4222-8222-222222222222'

      const start = await send('GET', CHANGE_URL)
      const principal = await send('GET', PRINCIPAL_URL)
      const toName = await send('POST', PRINCIPAL_URL, { principalId: otherId })
      const name = await send('GET', NAME_URL)
      const toCheck = await send('POST', NAME_URL, { name: 'flood-reports-2' })
      const check = await send('GET', CHECK_URL)
      await send('POST', CHECK_URL, {
        key: check.$('input[name="key"]').attr('value')
      })

      expect(start.response.headers.location).toBe(PRINCIPAL_URL)
      expect(principal.$('#principalId').attr('value')).toBe(PRINCIPAL_ID)
      expect(toName.response.headers.location).toBe(NAME_URL)
      expect(name.$('#name').attr('value')).toBe('flood-reports')
      expect(toCheck.response.headers.location).toBe(CHECK_URL)
      expect(JSON.parse(calls('PATCH', APPLICATION_PATH)[0][1].body)).toEqual({
        principalId: otherId,
        name: 'flood-reports-2'
      })
    })

    test('says on the check page when the new values are another application’s, naming the environment and never another team (AC16)', async () => {
      backend({
        [`PATCH ${APPLICATION_PATH}`]: reply(409, {
          code: 'federation-trusted-elsewhere',
          message: 'Taken'
        })
      })
      await send('GET', CHANGE_URL)
      await send('POST', SERVICE_URL, { service: 'flood-api-v2' })
      const { $ } = await send('GET', CHECK_URL)

      const { response, $: page } = await send('POST', CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text(page, '.govuk-error-summary')).toContain(
        'Infradev: another team already uses flood-api-v2 there'
      )
      expect(page('.govuk-error-summary a').attr('href')).toBe(
        '#change-service'
      )
    })

    test.each([
      [
        'federation-exists',
        'Infradev: your team already federates flood-api-v2 there'
      ],
      [
        'federation-unchanged',
        'These are the same as flood-api has now. Change them, or go back.'
      ]
    ])('says what %s means on the check page', async (code, message) => {
      backend({
        [`PATCH ${APPLICATION_PATH}`]: reply(409, { code, message: 'No' })
      })
      await send('GET', CHANGE_URL)
      await send('POST', SERVICE_URL, { service: 'flood-api-v2' })
      const { $ } = await send('GET', CHECK_URL)

      const { response, $: page } = await send('POST', CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text(page, '.govuk-error-summary')).toContain(message)
    })

    test.each([
      [
        'federation-in-progress',
        statusCodes.conflict,
        'This application is still changing'
      ],
      [
        'admin-required',
        statusCodes.forbidden,
        'You cannot change this application'
      ],
      [
        'environment-not-set-up',
        statusCodes.conflict,
        'This environment is not set up yet'
      ]
    ])('says %s in words', async (code, status, heading) => {
      backend({
        [`PATCH ${APPLICATION_PATH}`]: reply(status, { code, message: 'No' })
      })
      await send('GET', CHANGE_URL)
      await send('POST', SERVICE_URL, { service: 'flood-api-v2' })
      const { $ } = await send('GET', CHECK_URL)

      const { response, $: page } = await send('POST', CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(response.statusCode).toBe(status)
      expect(text(page, 'h1')).toBe(heading)
    })

    test('keeps the answers and says so when the backend fails', async () => {
      backend({
        [`PATCH ${APPLICATION_PATH}`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })
      await send('GET', CHANGE_URL)
      await send('POST', SERVICE_URL, { service: 'flood-api-v2' })
      const { $ } = await send('GET', CHECK_URL)

      const { response, $: page } = await send('POST', CHECK_URL, {
        key: $('input[name="key"]').attr('value')
      })

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(page, '.govuk-error-summary')).toContain(
        'We could not make this change just now'
      )
    })

    test('refuses a Member, as the backend does (AC18)', async () => {
      backend({ role: 'user' })

      const { response, $ } = await send('GET', CHANGE_URL)

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(text($, 'h1')).toBe('You cannot change this application')
      expect(calls('GET', ENVIRONMENT_PATH)).toHaveLength(0)
    })

    test('is a 404 for an application that is not in the environment, such as another team’s (AC18)', async () => {
      backend({ applications: [] })

      const { response, $ } = await send('GET', CHANGE_URL)

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(text($, 'h1')).toBe('Application not found')
    })

    test.each(['setting-up', 'removing', 'failed'])(
      'does not change an application that is %s',
      async (status) => {
        backend({ applications: [federatedApplication({ status })] })

        const { response } = await send('GET', CHANGE_URL)

        expect(response.statusCode).toBe(statusCodes.conflict)
      }
    )

    test('is a 404 for an environment this instance does not offer, and for a person who is not a member', async () => {
      backend()

      const offered = await send(
        'GET',
        `${INFRADEV_URL.replace('infradev', 'prod')}/applications/app-1/change`
      )

      expect(offered.response.statusCode).toBe(statusCodes.notFound)
      expect(text(offered.$, 'h1')).toBe('Environment not found')

      backend({
        [`GET ${TEAM_PATH}`]: reply(404, {
          code: 'error',
          message: 'Not found'
        })
      })

      expect((await send('GET', CHANGE_URL)).response.statusCode).toBe(
        statusCodes.notFound
      )
    })

    test('says the environment is not available when the backend says so', async () => {
      backend({
        [`GET ${ENVIRONMENT_PATH}`]: reply(404, {
          code: 'environment-not-available'
        })
      })

      const { response, $ } = await send('GET', CHANGE_URL)

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(text($, 'h1')).toBe('Environment not found')
    })

    test('says it cannot read the environment just now when the backend fails', async () => {
      backend({
        [`GET ${ENVIRONMENT_PATH}`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { response } = await send('GET', CHANGE_URL)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
    })
  })

  describe('Remove', () => {
    test('warns that the application stops getting new tokens and what happens to the ones it has, before anything is removed (AC19)', async () => {
      backend()

      const { response, $ } = await send('GET', REMOVE_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, 'h1')).toBe('Remove flood-api from Infradev?')
      expect(text($, '[data-testid="remove-warning"]')).toContain(
        'flood-api will stop getting new tokens in Infradev. Tokens it already has work until they expire'
      )
      expect(text($, 'main form button')).toBe('Remove flood-api')
      expect($('main form button').hasClass('govuk-button--warning')).toBe(true)
      expect($('[data-testid="cancel-remove"]').attr('href')).toBe(INFRADEV_URL)
      expect($('main form input[name="crumb"]')).toHaveLength(1)
      expect(calls('DELETE', APPLICATION_PATH)).toHaveLength(0)
    })

    test('removes it after the warning, leaves the others alone, and says on the environment page it is being removed (AC19)', async () => {
      backend({
        [`DELETE ${APPLICATION_PATH}`]: reply(202, {
          federation: federatedApplication({ status: 'removing' })
        })
      })

      const { response } = await send('POST', REMOVE_URL, {})
      const page = await send('GET', INFRADEV_URL)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(INFRADEV_URL)
      expect(calls('DELETE', APPLICATION_PATH)).toHaveLength(1)
      expect(
        calls('DELETE', `${ENVIRONMENT_PATH}/federations/app-2`)
      ).toHaveLength(0)
      expect(text(page.$, '[data-testid="team-notification"]')).toContain(
        'flood-api is being removed from Infradev'
      )
    })

    test('lets an admin clear away a failed application', async () => {
      backend({
        applications: [federatedApplication({ status: 'failed' })],
        [`DELETE ${APPLICATION_PATH}`]: reply(202, {
          federation: federatedApplication({ status: 'removing' })
        })
      })

      const { response } = await send('POST', REMOVE_URL, {})

      expect(response.statusCode).toBe(statusCodes.seeOther)
    })

    test.each(['setting-up', 'removing'])(
      'does not remove an application that is %s',
      async (status) => {
        backend({ applications: [federatedApplication({ status })] })

        const get = await send('GET', REMOVE_URL)
        const post = await send('POST', REMOVE_URL, {})

        expect(get.response.statusCode).toBe(statusCodes.conflict)
        expect(post.response.statusCode).toBe(statusCodes.conflict)
        expect(calls('DELETE', APPLICATION_PATH)).toHaveLength(0)
      }
    )

    test('refuses a Member, and asks the backend for nothing (AC18)', async () => {
      backend({ role: 'user' })

      const get = await send('GET', REMOVE_URL)
      const post = await send('POST', REMOVE_URL, {})

      expect(get.response.statusCode).toBe(statusCodes.forbidden)
      expect(post.response.statusCode).toBe(statusCodes.forbidden)
      expect(calls('DELETE', APPLICATION_PATH)).toHaveLength(0)
    })

    test('is a 404 for an application that is not in the environment (AC18)', async () => {
      backend({ applications: [] })

      expect((await send('GET', REMOVE_URL)).response.statusCode).toBe(
        statusCodes.notFound
      )
      expect((await send('POST', REMOVE_URL, {})).response.statusCode).toBe(
        statusCodes.notFound
      )
    })

    test('says so when the backend says the application is not there or still changing', async () => {
      backend({
        [`DELETE ${APPLICATION_PATH}`]: reply(404, { code: 'error' })
      })

      expect((await send('POST', REMOVE_URL, {})).response.statusCode).toBe(
        statusCodes.notFound
      )

      backend({
        [`DELETE ${APPLICATION_PATH}`]: reply(409, {
          code: 'federation-in-progress'
        })
      })

      const { response, $ } = await send('POST', REMOVE_URL, {})

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, 'h1')).toBe('flood-api cannot be changed just now')
    })

    test('says the person cannot when the backend refuses them', async () => {
      backend({
        [`DELETE ${APPLICATION_PATH}`]: reply(403, { code: 'admin-required' })
      })

      const { response } = await send('POST', REMOVE_URL, {})

      expect(response.statusCode).toBe(statusCodes.forbidden)
    })

    test('keeps the page and says so when the backend fails, so the person can try again', async () => {
      backend({
        [`DELETE ${APPLICATION_PATH}`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { response, $ } = await send('POST', REMOVE_URL, {})

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text($, '.govuk-error-summary')).toContain(
        'We could not remove this application just now'
      )
    })

    test('throws a code it does not know, so it is not hidden', async () => {
      backend({
        [`DELETE ${APPLICATION_PATH}`]: reply(409, { code: 'something-new' })
      })

      const { response } = await send('POST', REMOVE_URL, {})

      expect(response.statusCode).toBe(statusCodes.internalServerError)
    })
  })
})

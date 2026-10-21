import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
  nanoModel,
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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const TEAM_PATH = `/v1/teams/${sampleTeam.slug}`
const TEAM_URL = `/teams/${sampleTeam.slug}`
const SECRET_URL = `${TEAM_URL}/client-secrets/cred-1`
const CREDENTIAL_PATH = '/v1/credentials/cred-1'
const NOT_FOUND = reply(404, { code: 'not-found', message: 'Not Found' })

const credential = {
  _id: 'cred-1',
  tier: 'team',
  teamId: 'team-1',
  environment: 'infradev',
  status: 'active',
  keyHint: 'ab12',
  allowedDeployments: ['gpt-4o', 'gpt-4-1-nano'],
  expiresAt: null
}

describe('#clientSecretsController', () => {
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
    cookies = await signInViaOidc(server, fetchMock)
  })

  // What a person's team page and these pages read. `role: null` is a person
  // who is not on the team, such as one with only their own keys.
  function backend({ role = 'admin', current = credential, ...routes } = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: role
        ? { ...teamWithMembers(role), environments: [] }
        : NOT_FOUND,
      [`GET ${CREDENTIAL_PATH}`]: current,
      'GET /v1/models': { items: [sampleModel, nanoModel] },
      [`GET ${TEAM_PATH}/deployments`]: { items: [] },
      'GET /v1/credentials': { items: [current] },
      ...routes
    })
  }

  function get(url, jar = cookies) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(jar) }
    })
  }

  function post(url, payload = {}) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, ...payload }
    })
  }

  function calledWith(method, text) {
    return fetchMock.mock.calls.some(
      ([url, init]) => url.includes(text) && init.method === method
    )
  }

  describe('who can reach it', () => {
    test.each([
      ['view', 'GET'],
      ['view', 'POST'],
      ['rotate', 'GET'],
      ['rotate', 'POST'],
      ['revoke', 'GET'],
      ['revoke', 'POST']
    ])(
      '%s (%s) is not found for a member who is not an admin',
      async (step, method) => {
        backend({ role: 'user' })

        const response =
          method === 'GET'
            ? await get(`${SECRET_URL}/${step}`)
            : await post(`${SECRET_URL}/${step}`, {
                reason: 'Debugging a failed call',
                confirmRevoke: 'yes'
              })

        expect(response.statusCode).toBe(statusCodes.notFound)
        expect(response.result).toContain('Client secret not found')
        expect(calledWith('POST', '/reveal')).toBe(false)
        expect(calledWith('POST', '/rotate')).toBe(false)
        expect(calledWith('DELETE', '/v1/credentials')).toBe(false)
      }
    )

    test('is not found for a person who is not on the team, such as one with only their own keys', async () => {
      backend({ role: null })

      const { statusCode, result } = await get(`${SECRET_URL}/view`)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Client secret not found')
      expect(
        fetchMock.mock.calls.some(([url]) => url.includes(CREDENTIAL_PATH))
      ).toBe(false)
    })

    test.each([
      [
        'another team’s client secret',
        { current: { ...credential, teamId: 'team-2' } }
      ],
      ['a personal key', { current: { ...credential, tier: 'research' } }],
      ['one that does not exist', { [`GET ${CREDENTIAL_PATH}`]: NOT_FOUND }]
    ])('is not found for %s, even for an admin', async (_what, overrides) => {
      backend(overrides)

      const { statusCode } = await get(`${SECRET_URL}/view`)

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('fails rather than hiding a backend fault', async () => {
      backend({
        [`GET ${CREDENTIAL_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode } = await get(`${SECRET_URL}/view`)

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('is for signed-in people only', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: `${SECRET_URL}/view`
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toContain('/sign-in')
    })
  })

  describe('showing it', () => {
    test('asks an admin why, names the environment and the team, and goes back to the Models tab', async () => {
      backend()

      const { statusCode, result } = await get(`${SECRET_URL}/view`)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(
        'View the Development client secret for Flood Risk Team'
      )
      expect(result).toContain('Why do you need to see this?')
      expect(result).toContain(
        `<a href="${TEAM_URL}" class="govuk-back-link">Back</a>`
      )
    })

    test('asks for a reason, keeping what was typed', async () => {
      backend()

      const { statusCode, result } = await post(`${SECRET_URL}/view`, {
        reason: '   '
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('There is a problem')
      expect(result).toContain('Enter why you need to see this')
      expect(calledWith('POST', '/reveal')).toBe(false)
    })

    test('keeps a client secret that is not the admin’s to show as not found when the reason is missing', async () => {
      backend({ role: 'user' })

      const { statusCode } = await post(`${SECRET_URL}/view`, { reason: '' })

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('reveals it once, with the reason recorded, never cached', async () => {
      backend({
        [`POST ${CREDENTIAL_PATH}/reveal`]: { secret: 'full_client_secret' }
      })

      const revealed = await post(`${SECRET_URL}/view`, {
        reason: 'Setting up our pipeline'
      })

      expect(revealed.statusCode).toBe(statusCodes.seeOther)
      expect(revealed.headers.location).toBe(`${SECRET_URL}/revealed`)

      const [, init] = fetchMock.mock.calls.find(
        ([url, options]) =>
          url.includes(`${CREDENTIAL_PATH}/reveal`) && options.method === 'POST'
      )

      expect(JSON.parse(init.body)).toEqual({
        reason: 'Setting up our pipeline'
      })

      const jar = mergeCookies(cookies, revealed)
      const page = await get(`${SECRET_URL}/revealed`, jar)

      expect(page.statusCode).toBe(statusCodes.ok)
      expect(page.headers['cache-control']).toContain('no-store')
      expect(page.result).toContain('full_client_secret')
      expect(page.result).toContain('Your client secret')
      expect(page.result).toContain(`href="${TEAM_URL}">Back to the team`)

      const again = await get(`${SECRET_URL}/revealed`, mergeCookies(jar, page))

      expect(again.statusCode).toBe(statusCodes.seeOther)
      expect(again.headers.location).toBe(TEAM_URL)
    })

    test('warns that a mocked secret will not work against the gateway', async () => {
      backend({
        current: { ...credential, issuerKey: 'mock' },
        [`POST ${CREDENTIAL_PATH}/reveal`]: { secret: 'full_client_secret' }
      })

      const revealed = await post(`${SECRET_URL}/view`, { reason: 'Testing' })
      const page = await get(
        `${SECRET_URL}/revealed`,
        mergeCookies(cookies, revealed)
      )

      expect(page.result).toContain(
        'data-testid="placeholder-credential-notice"'
      )
    })

    test('does not show a secret revealed for another client secret', async () => {
      backend({
        [`POST ${CREDENTIAL_PATH}/reveal`]: { secret: 'full_client_secret' }
      })

      const revealed = await post(`${SECRET_URL}/view`, { reason: 'Testing' })
      const page = await get(
        `${TEAM_URL}/client-secrets/cred-2/revealed`,
        mergeCookies(cookies, revealed)
      )

      expect(page.statusCode).toBe(statusCodes.seeOther)
      expect(page.headers.location).toBe(TEAM_URL)
    })

    test.each([
      ['admin-required', 409, 'Only a team admin can view this client secret.'],
      ['credential-revoked', 409, 'This client secret has been revoked.'],
      ['not-found', 404, 'This client secret could not be found.']
    ])(
      'explains a refusal (%s) on the Models tab',
      async (code, status, message) => {
        backend({
          [`POST ${CREDENTIAL_PATH}/reveal`]: reply(status, {
            code,
            message: 'No'
          })
        })

        const refused = await post(`${SECRET_URL}/view`, { reason: 'Testing' })

        expect(refused.statusCode).toBe(statusCodes.seeOther)
        expect(refused.headers.location).toBe(TEAM_URL)

        const page = await get(TEAM_URL, mergeCookies(cookies, refused))

        expect(page.result).toContain(message)
      }
    )

    test('fails rather than hiding a broken backend', async () => {
      backend({
        [`POST ${CREDENTIAL_PATH}/reveal`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { statusCode } = await post(`${SECRET_URL}/view`, {
        reason: 'Testing'
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  describe('rotating it', () => {
    test('asks an admin to confirm, naming the team, environment and models, with a way back', async () => {
      backend()

      const { statusCode, result } = await get(`${SECRET_URL}/rotate`)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(
        'Are you sure you want to rotate the Flood Risk Team client secret?'
      )
      expect(result).toContain(
        'Anything using the old client secret stops working straight away.'
      )
      expect(result).toContain('ends ab12')
      expect(result).toContain('GPT-4o and GPT-4.1 nano')
      expect(result).toContain('Development')
      expect(result).toContain('Yes, rotate the client secret')
      expect(result).toContain(
        `<a class="govuk-link" href="${TEAM_URL}">No, keep the client secret I have</a>`
      )
      expect(result).toContain(
        `<a href="${TEAM_URL}" class="govuk-back-link">Back to Flood Risk Team</a>`
      )
    })

    test('names a model by its slug when the catalogue no longer lists it', async () => {
      backend({
        current: { ...credential, allowedDeployments: ['retired-model'] }
      })

      const { result } = await get(`${SECRET_URL}/rotate`)

      expect(result).toContain('retired-model')
    })

    test('rotates it and shows the new secret once, never cached', async () => {
      backend({
        [`POST ${CREDENTIAL_PATH}/rotate`]: {
          credential,
          secret: 'new_client_secret'
        }
      })

      const rotated = await post(`${SECRET_URL}/rotate`)

      expect(rotated.statusCode).toBe(statusCodes.seeOther)
      expect(rotated.headers.location).toBe(`${SECRET_URL}/rotated`)

      const jar = mergeCookies(cookies, rotated)
      const page = await get(`${SECRET_URL}/rotated`, jar)

      expect(page.statusCode).toBe(statusCodes.ok)
      expect(page.headers['cache-control']).toContain('no-store')
      expect(page.result).toContain('Client secret rotated')
      expect(page.result).toContain('new_client_secret')
      expect(page.result).toContain(
        'The old secret for GPT-4o and GPT-4.1 nano no longer works'
      )
      expect(page.result).toContain('Does not expire')
      expect(page.result).toContain(`href="${TEAM_URL}">Back to the team`)

      const again = await get(`${SECRET_URL}/rotated`, mergeCookies(jar, page))

      expect(again.statusCode).toBe(statusCodes.seeOther)
      expect(again.headers.location).toBe(TEAM_URL)
    })

    test('names the models before it rotates, so a failure to name them cannot lose the new secret', async () => {
      backend({
        'GET /v1/models': reply(502, { code: 'upstream-unavailable' }),
        [`POST ${CREDENTIAL_PATH}/rotate`]: {
          credential,
          secret: 'new_client_secret'
        }
      })

      const { statusCode } = await post(`${SECRET_URL}/rotate`)

      expect(statusCode).toBe(statusCodes.internalServerError)
      expect(calledWith('POST', '/rotate')).toBe(false)
    })

    test('does not show a rotated secret on another client secret’s address', async () => {
      backend({
        [`POST ${CREDENTIAL_PATH}/rotate`]: {
          credential,
          secret: 'new_client_secret'
        }
      })

      const rotated = await post(`${SECRET_URL}/rotate`)
      const page = await get(
        `${TEAM_URL}/client-secrets/cred-2/rotated`,
        mergeCookies(cookies, rotated)
      )

      expect(page.statusCode).toBe(statusCodes.seeOther)
    })

    test('says so on the Models tab when the backend refuses a person who is no longer an admin', async () => {
      backend({
        [`POST ${CREDENTIAL_PATH}/rotate`]: reply(403, {
          code: 'admin-required',
          message: 'No'
        })
      })

      const refused = await post(`${SECRET_URL}/rotate`)

      expect(refused.statusCode).toBe(statusCodes.seeOther)

      const page = await get(TEAM_URL, mergeCookies(cookies, refused))

      expect(page.result).toContain(
        'Only a team admin can rotate this client secret.'
      )
    })
  })

  describe('revoking it', () => {
    test('asks an admin to confirm, naming the environment and models', async () => {
      backend()

      const { statusCode, result } = await get(`${SECRET_URL}/revoke`)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(
        'Are you sure you want to revoke the Flood Risk Team client secret?'
      )
      expect(result).toContain(
        'Revoking the Development client secret cannot be undone. Anything using it to reach GPT-4o and GPT-4.1 nano stops working straight away.'
      )
      expect(result).toContain('Yes, revoke the client secret')
      expect(result).toContain('No, take me back to Flood Risk Team')
      expect(result).toContain(
        `<a href="${TEAM_URL}" class="govuk-back-link">Back</a>`
      )
    })

    test('asks which, when neither is chosen', async () => {
      backend()

      const { statusCode, result } = await post(`${SECRET_URL}/revoke`)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('There is a problem')
      expect(result).toContain(
        'Select yes if you want to revoke this credential'
      )
      expect(calledWith('DELETE', '/v1/credentials')).toBe(false)
    })

    test('is not found, rather than a form, for a client secret that is not the admin’s to revoke', async () => {
      backend({ role: 'user' })

      const { statusCode } = await post(`${SECRET_URL}/revoke`)

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('takes no action on "no", and goes back to the team', async () => {
      backend()

      const { statusCode, headers } = await post(`${SECRET_URL}/revoke`, {
        confirmRevoke: 'no'
      })

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe(TEAM_URL)
      expect(calledWith('DELETE', '/v1/credentials')).toBe(false)
    })

    test('revokes it on "yes" and says so on the Models tab', async () => {
      backend({ [`DELETE ${CREDENTIAL_PATH}`]: reply(204) })

      const revoked = await post(`${SECRET_URL}/revoke`, {
        confirmRevoke: 'yes'
      })

      expect(revoked.statusCode).toBe(statusCodes.seeOther)
      expect(revoked.headers.location).toBe(TEAM_URL)
      expect(calledWith('DELETE', CREDENTIAL_PATH)).toBe(true)

      const page = await get(TEAM_URL, mergeCookies(cookies, revoked))

      expect(page.result).toContain('Client secret revoked.')
      expect(page.result).toContain('govuk-notification-banner--success')
    })

    test('says so on the Models tab when the backend refuses a person who is no longer an admin', async () => {
      backend({
        [`DELETE ${CREDENTIAL_PATH}`]: reply(403, {
          code: 'admin-required',
          message: 'No'
        })
      })

      const refused = await post(`${SECRET_URL}/revoke`, {
        confirmRevoke: 'yes'
      })
      const page = await get(TEAM_URL, mergeCookies(cookies, refused))

      expect(page.result).toContain(
        'Only a team admin can revoke this client secret.'
      )
    })

    test('says it could not be revoked for any other refusal', async () => {
      backend({
        [`DELETE ${CREDENTIAL_PATH}`]: reply(404, {
          code: 'not-found',
          message: 'No'
        })
      })

      const refused = await post(`${SECRET_URL}/revoke`, {
        confirmRevoke: 'yes'
      })
      const page = await get(TEAM_URL, mergeCookies(cookies, refused))

      expect(page.result).toContain('This client secret could not be revoked.')
    })
  })
})

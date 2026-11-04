import { ecsFormat } from '@elastic/ecs-pino-format'
import { pino } from 'pino'

import { config } from '#/config/config.js'
import {
  API_CLIENT_ID,
  CLIENT_ID,
  CLIENT_SECRET,
  TENANT,
  blockNetwork,
  clearInterceptors,
  endNetworkBlock,
  interceptDiscovery,
  interceptTokenEndpoint,
  tokenResponse
} from '#/test-helpers/entra-network.js'
import {
  getAppToken,
  getUserToken,
  resetAppToken,
  tokensFromResponse
} from './access-token.js'
import { resetOidcConfig } from './oidc-client.js'
import { getSessionTokens } from './session.js'

// The test setup replaces getAppToken for every other file.
vi.unmock('#/server/common/helpers/access-token.js')

// The real openid-client and the real oidc-client.js run: only what answers
// over the network (Entra's discovery and token endpoints) is intercepted.
const MINUTE = 60 * 1000
const START = Date.parse('2026-11-04T09:00:00Z')

function mockRequest(tokens, logger = pino({ level: 'silent' })) {
  const store = tokens ? { tokens } : {}

  return {
    yar: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value
      }
    },
    logger
  }
}

// A real logger writing what the service would emit (ECS format), kept as text.
function capturingLogger() {
  const lines = []
  const logger = pino(
    { ...ecsFormat(), level: 'info' },
    {
      write: (line) => lines.push(line)
    }
  )

  return { logger, output: () => lines.join('') }
}

function sessionTokens(overrides = {}) {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: START + 60 * MINUTE,
    ...overrides
  }
}

function grantResponse(overrides = {}) {
  return {
    access_token: 'access-2',
    refresh_token: 'refresh-2',
    expires_in: 3600,
    ...overrides
  }
}

const USER_SCOPE = `openid profile email offline_access api://${API_CLIENT_ID}/Portal.Access`
const refreshGrant = (refreshToken) => ({
  grant_type: 'refresh_token',
  refresh_token: refreshToken,
  scope: USER_SCOPE,
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET
})

describe('#access tokens', () => {
  beforeAll(blockNetwork)
  afterAll(endNetworkBlock)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    vi.spyOn(config, 'get').mockImplementation(
      (key) =>
        ({
          'azureAd.tenantId': TENANT,
          'azureAd.clientId': CLIENT_ID,
          'azureAd.apiClientId': API_CLIENT_ID,
          'azureAd.clientSecret': CLIENT_SECRET,
          'azureAd.authMethod': 'client-secret'
        })[key] ?? config.default(key)
    )
    resetOidcConfig()
    resetAppToken()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    clearInterceptors()
  })

  describe('#tokensFromResponse', () => {
    test('turns a token response into what the session keeps, with the time it ends', () => {
      expect(tokensFromResponse(grantResponse())).toEqual({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresAt: START + 3600 * 1000
      })
    })

    test('keeps the refresh token already held when the response has no new one', () => {
      expect(
        tokensFromResponse(
          grantResponse({ refresh_token: undefined }),
          sessionTokens()
        ).refreshToken
      ).toBe('refresh-1')
    })
  })

  describe('#getUserToken', () => {
    test('gives the stored token while more than 2 minutes are left, asking Entra nothing', async () => {
      const entra = interceptDiscovery()
      const request = mockRequest(
        sessionTokens({ expiresAt: START + 2 * MINUTE + 1 })
      )

      await expect(getUserToken(request)).resolves.toBe('access-1')
      expect(entra.scope.isDone()).toBe(false)
    })

    test('refreshes it 2 minutes before it expires, with a refresh grant for the same scopes, the client authenticated', async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(tokenResponse())
      const request = mockRequest(
        sessionTokens({ expiresAt: START + 2 * MINUTE })
      )

      await expect(getUserToken(request)).resolves.toBe('access-2')

      expect(token.requests).toEqual([refreshGrant('refresh-1')])
    })

    test('stores the new token and the replaced refresh token in the session', async () => {
      interceptDiscovery()
      interceptTokenEndpoint(tokenResponse())
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))

      await getUserToken(request)

      expect(getSessionTokens(request)).toEqual({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresAt: START + 3600 * 1000
      })
    })

    test('keeps the refresh token it holds when Entra sends no new one', async () => {
      interceptDiscovery()
      interceptTokenEndpoint(tokenResponse({ refresh_token: undefined }))
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))

      await getUserToken(request)

      expect(getSessionTokens(request).refreshToken).toBe('refresh-1')
    })

    test('uses the refreshed token on the next call without refreshing again', async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(tokenResponse())
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))

      await getUserToken(request)
      await expect(getUserToken(request)).resolves.toBe('access-2')

      expect(token.requests).toHaveLength(1)
    })

    test('refreshes once when several calls need it at the same time', async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(tokenResponse())
      const first = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      const second = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))

      const tokens = await Promise.all([
        getUserToken(first),
        getUserToken(second)
      ])

      expect(tokens).toEqual(['access-2', 'access-2'])
      expect(token.requests).toHaveLength(1)
      expect(getSessionTokens(second).accessToken).toBe('access-2')
    })

    test('asks again for a later refresh with the replaced refresh token, once the first has finished', async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(
        tokenResponse(),
        tokenResponse({ access_token: 'access-3', refresh_token: 'refresh-3' })
      )
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      await getUserToken(request)

      vi.setSystemTime(START + 59 * MINUTE)

      await expect(getUserToken(request)).resolves.toBe('access-3')
      expect(token.requests).toEqual([
        refreshGrant('refresh-1'),
        refreshGrant('refresh-2')
      ])
    })

    test('is a 401 that can end the session when Entra refuses the refresh', async () => {
      interceptDiscovery()
      interceptTokenEndpoint([400, { error: 'invalid_grant' }])
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))

      await expect(getUserToken(request)).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 401,
        code: 'token-refresh-failed'
      })
    })

    test('does not keep a failed refresh: the next call asks Entra again', async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(
        [400, { error: 'invalid_grant' }],
        tokenResponse()
      )
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      await getUserToken(request).catch(() => {})

      await expect(getUserToken(request)).resolves.toBe('access-2')
      expect(token.requests).toHaveLength(2)
    })

    test('logs what kind of refresh failure it was, in Entra’s terms, and none of the tokens, secrets or Entra’s description', async () => {
      interceptDiscovery()
      // Entra can put what it was sent into its error text; that must never be logged.
      interceptTokenEndpoint([
        400,
        {
          error: 'invalid_grant',
          error_description: `AADSTS70000: could not redeem refresh_token=refresh-1 with client_secret=${CLIENT_SECRET}`
        }
      ])
      const { logger, output } = capturingLogger()
      const request = mockRequest(
        sessionTokens({ expiresAt: START + MINUTE }),
        logger
      )

      await getUserToken(request).catch(() => {})

      const emitted = output()

      expect(JSON.parse(emitted)).toMatchObject({
        message: 'Refreshing the access token failed',
        'log.level': 'warn',
        error: { type: 'ResponseBodyError', code: 'OAUTH_RESPONSE_BODY_ERROR' },
        oauth: { error: 'invalid_grant' }
      })
      expect(emitted).not.toContain('refresh-1')
      expect(emitted).not.toContain('access-1')
      expect(emitted).not.toContain(CLIENT_SECRET)
      expect(emitted).not.toContain('AADSTS70000')
    })

    test('logs a failure that carries the new tokens in its own message without the message or the stack', async () => {
      interceptDiscovery()
      interceptTokenEndpoint(tokenResponse())
      const { logger, output } = capturingLogger()
      const request = mockRequest(
        sessionTokens({ expiresAt: START + MINUTE }),
        logger
      )
      // The session store refusing the write, naming what it was asked to keep.
      request.yar.set = () => {
        throw new Error(
          'Session store refused {"accessToken":"access-2","refreshToken":"refresh-2"}'
        )
      }

      await expect(getUserToken(request)).rejects.toMatchObject({
        statusCode: 401,
        code: 'token-refresh-failed'
      })

      const emitted = output()

      expect(JSON.parse(emitted)).toMatchObject({
        message: 'Refreshing the access token failed',
        'log.level': 'warn',
        error: { type: 'Error' }
      })
      expect(emitted).not.toContain('access-2')
      expect(emitted).not.toContain('refresh-2')
      expect(emitted).not.toContain('refresh-1')
      expect(emitted).not.toContain('Session store refused')
    })

    test('is a 401 when Entra cannot be reached to refresh', async () => {
      interceptDiscovery({ answer: [503, { error: 'down' }] })
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))

      await expect(getUserToken(request)).rejects.toMatchObject({
        statusCode: 401,
        code: 'token-refresh-failed'
      })
    })

    test('is a 401, asking Entra nothing, when the person has tokens that cannot be refreshed', async () => {
      const entra = interceptDiscovery()
      const request = mockRequest(
        sessionTokens({ refreshToken: undefined, expiresAt: START + MINUTE })
      )

      await expect(getUserToken(request)).rejects.toMatchObject({
        statusCode: 401,
        code: 'token-refresh-failed'
      })
      expect(entra.scope.isDone()).toBe(false)
    })

    test('is a 401 when there are no tokens in the session', async () => {
      await expect(getUserToken(mockRequest())).rejects.toMatchObject({
        statusCode: 401,
        code: 'not-signed-in'
      })
    })
  })

  describe('#getAppToken', () => {
    const appGrant = {
      grant_type: 'client_credentials',
      scope: `api://${API_CLIENT_ID}/.default`,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    }

    test("asks Entra for the frontend's own token for the API's default scope, with the client authenticated for the grant", async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(
        tokenResponse({ access_token: 'app-1', refresh_token: undefined })
      )

      await expect(getAppToken()).resolves.toBe('app-1')

      expect(token.requests).toEqual([appGrant])
    })

    test('keeps it until 2 minutes before it expires', async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(
        tokenResponse({ access_token: 'app-1', expires_in: 600 }),
        tokenResponse({ access_token: 'app-2' })
      )
      await getAppToken()

      vi.setSystemTime(START + 7 * MINUTE)
      await expect(getAppToken()).resolves.toBe('app-1')
      expect(token.requests).toHaveLength(1)

      vi.setSystemTime(START + 8 * MINUTE)
      await expect(getAppToken()).resolves.toBe('app-2')
      expect(token.requests).toEqual([appGrant, appGrant])
    })

    test('asks once when several calls need it at the same time', async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(
        tokenResponse({ access_token: 'app-1' })
      )

      const tokens = await Promise.all([
        getAppToken(),
        getAppToken(),
        getAppToken()
      ])

      expect(tokens).toEqual(['app-1', 'app-1', 'app-1'])
      expect(token.requests).toHaveLength(1)
    })

    test('is a 502 when Entra cannot give a token, and asks again next time', async () => {
      interceptDiscovery()
      const token = interceptTokenEndpoint(
        [401, { error: 'invalid_client' }],
        tokenResponse({ access_token: 'app-1' })
      )

      await expect(getAppToken()).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 502,
        code: 'upstream-unavailable'
      })
      await expect(getAppToken()).resolves.toBe('app-1')

      expect(token.requests).toHaveLength(2)
    })

    test('is a 502 when Entra sign-in is not configured', async () => {
      vi.spyOn(config, 'get').mockImplementation((key) =>
        key === 'azureAd.tenantId' ? null : config.default(key)
      )

      await expect(getAppToken()).rejects.toMatchObject({ statusCode: 502 })
    })
  })
})

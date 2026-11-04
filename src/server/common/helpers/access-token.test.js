import { config } from '#/config/config.js'
import {
  getAppToken,
  getUserToken,
  resetAppToken,
  tokensFromResponse
} from './access-token.js'
import { getSessionTokens, setSessionTokens } from './session.js'

const refreshTokenGrant = vi.fn()
const clientCredentialsGrant = vi.fn()
const getOidcConfig = vi.fn()

// The test setup replaces getAppToken for every other file.
vi.unmock('#/server/common/helpers/access-token.js')

vi.mock('openid-client', () => ({
  refreshTokenGrant: (...args) => refreshTokenGrant(...args),
  clientCredentialsGrant: (...args) => clientCredentialsGrant(...args)
}))
vi.mock('#/server/common/helpers/oidc-client.js', () => ({
  getOidcConfig: (...args) => getOidcConfig(...args)
}))

const MINUTE = 60 * 1000
const START = Date.parse('2026-11-04T09:00:00Z')
const API = '44444444-4444-4444-8444-444444444444'

function mockRequest(tokens) {
  const store = tokens ? { tokens } : {}

  return {
    yar: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value
      }
    },
    logger: { warn: vi.fn() }
  }
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

describe('#access tokens', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    vi.spyOn(config, 'get').mockImplementation((key) =>
      key === 'azureAd.apiClientId' ? API : config.default(key)
    )
    getOidcConfig.mockResolvedValue('oidc-config')
    resetAppToken()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    refreshTokenGrant.mockReset()
    clientCredentialsGrant.mockReset()
    getOidcConfig.mockReset()
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
    test('gives the stored token while more than 2 minutes are left', async () => {
      const request = mockRequest(
        sessionTokens({ expiresAt: START + 2 * MINUTE + 1 })
      )

      await expect(getUserToken(request)).resolves.toBe('access-1')
      expect(refreshTokenGrant).not.toHaveBeenCalled()
    })

    test('refreshes it 2 minutes before it expires, asking for the same scopes', async () => {
      const request = mockRequest(
        sessionTokens({ expiresAt: START + 2 * MINUTE })
      )
      refreshTokenGrant.mockResolvedValue(grantResponse())

      await expect(getUserToken(request)).resolves.toBe('access-2')

      expect(refreshTokenGrant).toHaveBeenCalledWith(
        'oidc-config',
        'refresh-1',
        {
          scope: `openid profile email offline_access api://${API}/Portal.Access`
        }
      )
    })

    test('stores the new token and the replaced refresh token in the session', async () => {
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      refreshTokenGrant.mockResolvedValue(grantResponse())

      await getUserToken(request)

      expect(getSessionTokens(request)).toEqual({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresAt: START + 3600 * 1000
      })
    })

    test('uses the refreshed token on the next call without refreshing again', async () => {
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      refreshTokenGrant.mockResolvedValue(grantResponse())

      await getUserToken(request)
      await getUserToken(request)

      expect(refreshTokenGrant).toHaveBeenCalledTimes(1)
    })

    test('refreshes once when several calls need it at the same time', async () => {
      const first = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      const second = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      refreshTokenGrant.mockResolvedValue(grantResponse())

      const tokens = await Promise.all([
        getUserToken(first),
        getUserToken(second)
      ])

      expect(tokens).toEqual(['access-2', 'access-2'])
      expect(refreshTokenGrant).toHaveBeenCalledTimes(1)
      expect(getSessionTokens(second).accessToken).toBe('access-2')
    })

    test('asks again for a later refresh, once the first has finished', async () => {
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      refreshTokenGrant.mockResolvedValue(grantResponse())
      await getUserToken(request)

      vi.setSystemTime(START + 59 * MINUTE)
      refreshTokenGrant.mockResolvedValue(
        grantResponse({ access_token: 'access-3', refresh_token: 'refresh-3' })
      )

      await expect(getUserToken(request)).resolves.toBe('access-3')
      expect(refreshTokenGrant).toHaveBeenLastCalledWith(
        'oidc-config',
        'refresh-2',
        expect.any(Object)
      )
    })

    test('is a 401 that can end the session when the refresh fails, saying nothing of the tokens', async () => {
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      refreshTokenGrant.mockRejectedValue(new Error('invalid_grant'))

      await expect(getUserToken(request)).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 401,
        code: 'token-refresh-failed'
      })
      expect(request.logger.warn).toHaveBeenCalled()
      expect(JSON.stringify(request.logger.warn.mock.calls)).not.toContain(
        'refresh-1'
      )
    })

    test('is a 401 when Entra cannot be reached to refresh', async () => {
      const request = mockRequest(sessionTokens({ expiresAt: START + MINUTE }))
      getOidcConfig.mockRejectedValue(new Error('discovery failed'))

      await expect(getUserToken(request)).rejects.toMatchObject({
        statusCode: 401,
        code: 'token-refresh-failed'
      })
    })

    test('is a 401 when the person has tokens that cannot be refreshed', async () => {
      const request = mockRequest(
        sessionTokens({ refreshToken: undefined, expiresAt: START + MINUTE })
      )

      await expect(getUserToken(request)).rejects.toMatchObject({
        statusCode: 401,
        code: 'token-refresh-failed'
      })
      expect(refreshTokenGrant).not.toHaveBeenCalled()
    })

    test('is a 401 when there are no tokens in the session', async () => {
      await expect(getUserToken(mockRequest())).rejects.toMatchObject({
        statusCode: 401,
        code: 'not-signed-in'
      })
    })
  })

  describe('#getAppToken', () => {
    test("asks Entra for the frontend's own token for the API, with the federated or secret client authentication", async () => {
      clientCredentialsGrant.mockResolvedValue(
        grantResponse({ access_token: 'app-1', refresh_token: undefined })
      )

      await expect(getAppToken()).resolves.toBe('app-1')

      expect(clientCredentialsGrant).toHaveBeenCalledWith('oidc-config', {
        scope: `api://${API}/.default`
      })
    })

    test('keeps it until 2 minutes before it expires', async () => {
      clientCredentialsGrant.mockResolvedValue(
        grantResponse({ access_token: 'app-1', expires_in: 600 })
      )
      await getAppToken()

      vi.setSystemTime(START + 7 * MINUTE)
      await getAppToken()
      expect(clientCredentialsGrant).toHaveBeenCalledTimes(1)

      vi.setSystemTime(START + 8 * MINUTE)
      clientCredentialsGrant.mockResolvedValue(
        grantResponse({ access_token: 'app-2' })
      )

      await expect(getAppToken()).resolves.toBe('app-2')
      expect(clientCredentialsGrant).toHaveBeenCalledTimes(2)
    })

    test('asks once when several calls need it at the same time', async () => {
      clientCredentialsGrant.mockResolvedValue(
        grantResponse({ access_token: 'app-1' })
      )

      await Promise.all([getAppToken(), getAppToken(), getAppToken()])

      expect(clientCredentialsGrant).toHaveBeenCalledTimes(1)
    })

    test('is a 502 when Entra cannot give a token, and asks again next time', async () => {
      clientCredentialsGrant.mockRejectedValueOnce(new Error('Entra is down'))

      await expect(getAppToken()).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 502,
        code: 'upstream-unavailable'
      })

      clientCredentialsGrant.mockResolvedValue(
        grantResponse({ access_token: 'app-1' })
      )
      await expect(getAppToken()).resolves.toBe('app-1')
    })

    test('is a 502 when Entra sign-in is not configured', async () => {
      getOidcConfig.mockRejectedValueOnce(new Error('not configured'))

      await expect(getAppToken()).rejects.toMatchObject({ statusCode: 502 })
    })
  })

  test('keeps tokens in the session and nowhere else', () => {
    const request = mockRequest()

    setSessionTokens(request, sessionTokens())

    expect(getSessionTokens(request)).toEqual(sessionTokens())
  })
})

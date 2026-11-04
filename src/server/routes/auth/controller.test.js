import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { getOidcConfig } from '#/server/common/helpers/oidc-client.js'
import createFetchMock from 'vitest-fetch-mock'

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
      oid: '0f8fad5b-d9cb-469f-a165-70867728950e',
      tid: '7a1d2b3c-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      email: 'test.user@defra.gov.uk',
      name: 'Test User'
    })
  })),
  buildEndSessionUrl: vi.fn(
    () => new URL('https://login.microsoftonline.com/tenant/oauth2/v2.0/logout')
  )
}))

function extractSetCookies(response) {
  const setCookie = response.headers['set-cookie']
  return Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
}

function mergeCookies(jar, response) {
  for (const cookie of extractSetCookies(response)) {
    const [pair] = cookie.split(';')
    const [name, ...rest] = pair.split('=')
    jar[name] = rest.join('=')
  }
  return jar
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

describe('#authController', () => {
  let server

  async function signedInJar() {
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })
    const cookies = mergeCookies({}, loginResponse)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        user: {
          _id: 'user-1',
          email: 'test.user@defra.gov.uk',
          displayName: 'Test User'
        },
        team: null
      })
    )

    const callback = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })

    return mergeCookies(cookies, callback)
  }

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    getOidcConfig.mockResolvedValue('fake-oidc-config')
  })

  test('GET /auth/login redirects to the Entra ID authorization endpoint', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toContain('login.microsoftonline.com')
  })

  test('GET /auth/login renders a sign-in-unavailable page when Entra ID is not configured', async () => {
    getOidcConfig.mockRejectedValueOnce(new Error('not configured'))

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(result).toEqual(
      expect.stringContaining('Sign-in is currently unavailable')
    )
  })

  test('GET /auth/callback with no pending login redirects to /sign-in', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/callback'
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/sign-in')
  })

  test('GET /auth/callback exchanges the code, signs the person in with the backend using their access token and redirects to /', async () => {
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })
    const cookies = mergeCookies({}, loginResponse)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        user: {
          _id: 'user-1',
          email: 'test.user@defra.gov.uk',
          displayName: 'Test User'
        },
        team: null
      })
    )

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/')

    const [request] = fetchMock.requests()
    expect(request.method).toBe('PUT')
    expect(new URL(request.url).pathname).toBe('/v1/users/me')
    expect(request.headers.get('authorization')).toBe(
      'Bearer user-access-token'
    )
    expect(request.headers.get('x-user-id')).toBeNull()
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
  })

  test('GET /auth/callback keeps the tokens in the session, so later calls use them, and not in the browser', async () => {
    const cookies = await signedInJar()

    expect(Object.values(cookies).join(';')).not.toContain('user-access-token')
    expect(Object.values(cookies).join(';')).not.toContain('user-refresh-token')

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    await server.inject({
      method: 'GET',
      url: '/models',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(fetchMock.requests().at(-1).headers.get('authorization')).toBe(
      'Bearer user-access-token'
    )
  })

  test('GET /auth/login asks for offline access and the API scope as well as the OpenID scopes', async () => {
    const { buildAuthorizationUrl } = await import('openid-client')

    await server.inject({ method: 'GET', url: '/auth/login' })

    const { scope } = buildAuthorizationUrl.mock.calls.at(-1)[1]
    expect(scope.split(' ')).toEqual(
      expect.arrayContaining([
        'openid',
        'profile',
        'email',
        'offline_access',
        expect.stringMatching(/^api:\/\/.+\/Portal\.Access$/)
      ])
    )
  })

  test('GET /auth/callback gives the signed-in person a new session ID, not the one they had before sign-in', async () => {
    const ids = {}
    server.ext('onPreResponse', (request, h) => {
      ids[request.path] = request.yar.id
      return h.continue
    })

    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })
    const cookies = mergeCookies({}, loginResponse)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        user: {
          _id: 'user-1',
          email: 'test.user@defra.gov.uk',
          displayName: 'Test User'
        },
        team: null
      })
    )

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(ids['/auth/login']).toBeDefined()
    expect(ids['/auth/callback']).toBeDefined()
    expect(ids['/auth/callback']).not.toBe(ids['/auth/login'])
  })

  test("GET /auth/callback renews the session first and then keeps the tokens, so the next backend call carries the new session's user token (not the app token)", async () => {
    const ids = {}
    server.ext('onPreResponse', (request, h) => {
      ids[request.path] = request.yar.id
      return h.continue
    })
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })
    const cookies = mergeCookies({}, loginResponse)
    fetchMock.mockResponseOnce(
      JSON.stringify({
        user: { _id: 'user-1', email: 'a@defra.gov.uk', displayName: 'A' },
        team: null
      })
    )

    const callback = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })
    mergeCookies(cookies, callback)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    await server.inject({
      method: 'GET',
      url: '/models',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(ids['/auth/callback']).not.toBe(ids['/auth/login'])
    expect(ids['/models']).toBe(ids['/auth/callback'])
    expect(
      fetchMock.requests().map((r) => r.headers.get('authorization'))
    ).toEqual(['Bearer user-access-token', 'Bearer user-access-token'])
    expect(fetchMock.requests().at(-1).headers.get('authorization')).toBe(
      'Bearer user-access-token'
    )
  })

  test('GET /auth/callback redirects to returnTo when it was set before login', async () => {
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login?returnTo=%2Fmanage'
    })
    const cookies = mergeCookies({}, loginResponse)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        user: {
          _id: 'user-1',
          email: 'test.user@defra.gov.uk',
          displayName: 'Test User'
        },
        team: null
      })
    )

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/manage')
  })

  test.each([
    ['an off-site address', 'https%3A%2F%2Fattacker.example'],
    ['dot segments that normalise to //evil.com', '%2F.%2F%2Fevil.com'],
    [
      'a parent segment that normalises to //evil.com',
      '%2Fa%2F..%2F%2Fevil.com'
    ]
  ])(
    'GET /auth/callback ignores %s as returnTo and falls back to /',
    async (_name, returnTo) => {
      const loginResponse = await server.inject({
        method: 'GET',
        url: `/auth/login?returnTo=${returnTo}`
      })
      const cookies = mergeCookies({}, loginResponse)

      fetchMock.mockResponseOnce(
        JSON.stringify({
          user: {
            _id: 'user-1',
            email: 'test.user@defra.gov.uk',
            displayName: 'Test User'
          },
          team: null
        })
      )

      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/auth/callback?code=abc&state=state-123',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/')
    }
  )

  test('GET /auth/callback shows the refusal page, and ends the session, when the backend refuses the token (a guest)', async () => {
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })
    const cookies = mergeCookies({}, loginResponse)

    fetchMock.mockResponseOnce(
      JSON.stringify({ code: 'invalid-token', message: 'Unauthorized' }),
      { status: 401 }
    )

    const callback = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(callback.statusCode).toBe(statusCodes.forbidden)
    expect(callback.result).toEqual(
      expect.stringContaining('You cannot sign in with this account')
    )
    expect(callback.result).toEqual(
      expect.stringContaining('/sign-in?prompt=select_account')
    )

    // Nothing of the sign-in was kept: no tokens, no person.
    mergeCookies(cookies, callback)
    const next = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(next.statusCode).toBe(statusCodes.found)
    expect(next.headers.location).toBe('/sign-in?returnTo=%2Fmanage')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('GET /auth/callback ends the session and shows an error page when the backend fails for another reason', async () => {
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })
    const cookies = mergeCookies({}, loginResponse)

    fetchMock.mockResponseOnce(JSON.stringify({ code: 'error' }), {
      status: 500
    })

    const callback = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })
    mergeCookies(cookies, callback)
    const next = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(callback.statusCode).toBe(statusCodes.internalServerError)
    expect(next.headers.location).toBe('/sign-in?returnTo=%2Fmanage')
  })

  test('GET /auth/login passes prompt=select_account through to the authorization request', async () => {
    const { buildAuthorizationUrl } = await import('openid-client')

    await server.inject({
      method: 'GET',
      url: '/auth/login?prompt=select_account'
    })

    expect(buildAuthorizationUrl).toHaveBeenCalledWith(
      'fake-oidc-config',
      expect.objectContaining({ prompt: 'select_account' })
    )
  })

  test('GET /auth/login rejects an unsupported prompt value', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/auth/login?prompt=none'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('GET /auth/callback renders a sign-in-problem page when the code exchange fails', async () => {
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })
    const cookies = mergeCookies({}, loginResponse)

    const { authorizationCodeGrant } = await import('openid-client')
    authorizationCodeGrant.mockRejectedValueOnce(new Error('state mismatch'))

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('We could not sign you in'))
  })
})

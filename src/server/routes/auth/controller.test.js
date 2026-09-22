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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
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

  test('GET /auth/callback exchanges the code, upserts the user and redirects to /connect', async () => {
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
    expect(headers.location).toBe('/connect')
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

  test('GET /auth/callback shows a safe error page for a disallowed email domain', async () => {
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })
    const cookies = mergeCookies({}, loginResponse)

    fetchMock.mockResponseOnce(
      JSON.stringify({ code: 'domain-not-allowed', message: 'Not allowed' }),
      { status: 403 }
    )

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=state-123',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(result).toEqual(
      expect.stringContaining('You cannot sign in with this account')
    )
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

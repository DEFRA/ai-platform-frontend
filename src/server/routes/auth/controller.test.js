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

  test('GET /auth/callback exchanges the code, upserts the user and redirects to /', async () => {
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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      oid: '0f8fad5b-d9cb-469f-a165-70867728950e',
      tid: '7a1d2b3c-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      email: 'test.user@defra.gov.uk',
      displayName: 'Test User'
    })
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

  test('GET /auth/callback ignores an off-site returnTo and falls back to /', async () => {
    const loginResponse = await server.inject({
      method: 'GET',
      url: '/auth/login?returnTo=https%3A%2F%2Fattacker.example'
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
    expect(result).toEqual(
      expect.stringContaining('/sign-in?prompt=select_account')
    )
  })

  describe('the account that signs in', () => {
    async function callbackWith(claims) {
      const { authorizationCodeGrant } = await import('openid-client')
      const loginResponse = await server.inject({
        method: 'GET',
        url: '/auth/login'
      })
      const cookies = mergeCookies({}, loginResponse)

      authorizationCodeGrant.mockResolvedValueOnce({
        claims: () => ({
          oid: '0f8fad5b-d9cb-469f-a165-70867728950e',
          tid: '7a1d2b3c-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
          name: 'Test User',
          ...claims
        })
      })

      return server.inject({
        method: 'GET',
        url: '/auth/callback?code=abc&state=state-123',
        headers: { cookie: cookieHeader(cookies) }
      })
    }

    test.each([
      ['defra.gov.uk', { email: 'sam@defra.gov.uk' }, 'sam@defra.gov.uk'],
      [
        'defra.onmicrosoft.com',
        { email: 'sam@defra.onmicrosoft.com' },
        'sam@defra.onmicrosoft.com'
      ],
      [
        'DEFRA.GOV.UK, in any case',
        { email: 'Sam@DEFRA.GOV.UK' },
        'Sam@DEFRA.GOV.UK'
      ],
      [
        'defra.onmicrosoft.com as the user name when there is no email',
        { preferred_username: 'sam@defra.onmicrosoft.com' },
        'sam@defra.onmicrosoft.com'
      ]
    ])('signs in an account on %s', async (_name, claims, sent) => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          user: { _id: 'user-1', email: sent, displayName: 'Test User' }
        })
      )

      const { statusCode, headers } = await callbackWith(claims)

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/')
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).email).toBe(sent)
    })

    test.each([
      [
        'a guest (#EXT#) of defra.onmicrosoft.com',
        { preferred_username: 'sam_gmail.com#EXT#@defra.onmicrosoft.com' }
      ],
      [
        'a Defra email with a guest (#EXT#) user name',
        {
          email: 'sam@defra.gov.uk',
          preferred_username: 'sam_defra.gov.uk#EXT#@defra.onmicrosoft.com'
        }
      ],
      ['a subdomain of defra.gov.uk', { email: 'sam@sub.defra.gov.uk' }],
      [
        'a subdomain of defra.onmicrosoft.com',
        { email: 'sam@sub.defra.onmicrosoft.com' }
      ],
      [
        'a look-alike domain that starts with Defra’s',
        { email: 'sam@defra.gov.uk.example.com' }
      ],
      ['a look-alike domain', { email: 'sam@notdefra.gov.uk' }],
      ['another domain', { email: 'sam@example.com' }],
      ['no email at all', {}]
    ])(
      'refuses %s with the same page as the backend’s refusal, and signs no one in',
      async (_name, claims) => {
        const { statusCode, result } = await callbackWith(claims)

        expect(statusCode).toBe(statusCodes.forbidden)
        expect(result).toContain('You cannot sign in with this account')
        expect(result).toContain('/sign-in?prompt=select_account')
        expect(fetchMock.mock.calls).toHaveLength(0)
      }
    )
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

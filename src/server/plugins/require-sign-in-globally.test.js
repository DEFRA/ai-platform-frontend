import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

describe('#requireSignInGlobally', () => {
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
  })

  test('redirects an unauthenticated request for a protected route to sign in', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/manage'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/sign-in?returnTo=%2Fmanage')
  })

  test('allows GET /connect without a session, but not POST /connect', async () => {
    const getConnect = await server.inject({ method: 'GET', url: '/connect' })
    expect(getConnect.statusCode).toBe(statusCodes.ok)
    const cookies = mergeCookies({}, getConnect)

    const postConnect = await server.inject({
      method: 'POST',
      url: '/connect',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, accessType: 'shared' }
    })
    expect(postConnect.statusCode).toBe(302)
    expect(postConnect.headers.location).toBe('/sign-in?returnTo=%2Fconnect')
  })

  test('allows / and /about without a session', async () => {
    const home = await server.inject({ method: 'GET', url: '/' })
    expect(home.statusCode).toBe(statusCodes.ok)

    const about = await server.inject({ method: 'GET', url: '/about' })
    expect(about.statusCode).toBe(statusCodes.ok)
  })

  test('allows /health without a session', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(statusCode).toBe(statusCodes.ok)
  })

  test('allows /sign-in and /auth/login without a session', async () => {
    const signIn = await server.inject({ method: 'GET', url: '/sign-in' })
    expect(signIn.statusCode).toBe(statusCodes.seeOther)
    expect(signIn.headers.location).toBe('/auth/login')

    const login = await server.inject({ method: 'GET', url: '/auth/login' })
    expect(login.statusCode).toBe(302)
  })

  test('allows a protected route once signed in via Entra ID', async () => {
    const cookies = await signInViaOidc(server, fetchMock)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
  })
})

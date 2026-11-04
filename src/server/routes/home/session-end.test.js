import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { ApiError } from '#/server/common/helpers/api-error.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi } from '#/test-helpers/api-mock.js'
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
    () => new URL('https://login.microsoftonline.com/tenant/authorize')
  ),
  // An access token that lasts 150 s, so it is due for renewal 30 s in.
  authorizationCodeGrant: vi.fn(async () => ({
    access_token: 'user-access-token',
    refresh_token: 'user-refresh-token',
    expires_in: 150,
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  })),
  refreshTokenGrant: vi.fn(async () => {
    throw new Error('invalid_grant')
  })
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const START = Date.parse('2026-11-04T09:00:00Z')

// A page that reads with Promise.allSettled swallows what a read throws, so a
// failed refresh never reaches the error handler as an error. The session must
// still end (review FE-3).
describe('#a failed token refresh on a page that reads with Promise.allSettled', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    // A protected page whose read is refused by the backend as unauthorised.
    server.route({
      method: 'GET',
      path: '/test-refused',
      handler: () => {
        throw new ApiError({ statusCode: 401, code: 'invalid-token' })
      }
    })
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('ends the session and sends the person to sign in, back to the home page', async () => {
    const cookies = await signInViaOidc(server, fetchMock)
    vi.setSystemTime(START + 40 * 1000)
    mockApi(fetchMock, {
      'GET /v1/models': { items: [] },
      'GET /v1/teams': { items: [] },
      'GET /v1/credentials': { items: [] }
    })

    const home = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(home.statusCode).toBe(statusCodes.found)
    expect(home.headers.location).toBe('/sign-in?returnTo=%2F')

    // The same cookie finds no session now.
    mergeCookies(cookies, home)
    const next = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(next.headers.location).toBe('/sign-in?returnTo=%2Fmanage')
  })

  test('a read the backend refuses (401) also ends the session, and the same cookie then finds none', async () => {
    const cookies = await signInViaOidc(server, fetchMock)

    const refused = await server.inject({
      method: 'GET',
      url: '/test-refused',
      headers: { cookie: cookieHeader(cookies) }
    })
    mergeCookies(cookies, refused)
    const next = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(refused.statusCode).toBe(statusCodes.found)
    expect(refused.headers.location).toBe('/sign-in?returnTo=%2Ftest-refused')
    expect(next.headers.location).toBe('/sign-in?returnTo=%2Fmanage')
  })

  test('does not end the session while the token is still good', async () => {
    const cookies = await signInViaOidc(server, fetchMock)
    mockApi(fetchMock, {
      'GET /v1/models': { items: [] },
      'GET /v1/teams': { items: [] },
      'GET /v1/credentials': { items: [] }
    })

    const home = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(home.statusCode).toBe(statusCodes.ok)
  })
})

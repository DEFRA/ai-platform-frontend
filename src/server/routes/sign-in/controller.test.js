import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
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

describe('#signInController', () => {
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

  test('GET /sign-in redirects straight to the Entra ID login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/sign-in'
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/auth/login')
  })

  test('GET /sign-in preserves returnTo when redirecting to Entra ID login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/sign-in?returnTo=%2Fconnect'
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/auth/login?returnTo=%2Fconnect')
  })

  test('nav shows "Sign out" instead of "Sign in" on the very next page after finishing sign-in', async () => {
    const cookies = await signInViaOidc(server, fetchMock)

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/connect',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Sign out ('))
    expect(result).not.toEqual(expect.stringContaining('>Sign in<'))
  })
})

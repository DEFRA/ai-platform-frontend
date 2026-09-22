import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { getOidcConfig } from '#/server/common/helpers/oidc-client.js'
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
  })),
  buildEndSessionUrl: vi.fn(
    () => new URL('https://login.microsoftonline.com/tenant/oauth2/v2.0/logout')
  )
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

describe('#signOutController', () => {
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

  test('POST /sign-out clears the session and redirects to the Entra ID end-session URL', async () => {
    const cookies = await signInViaOidc(server, fetchMock)

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/sign-out',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe(
      'https://login.microsoftonline.com/tenant/oauth2/v2.0/logout'
    )
  })

  test('falls back to / if the Entra ID end-session URL cannot be built', async () => {
    const cookies = await signInViaOidc(server, fetchMock)
    getOidcConfig.mockRejectedValueOnce(new Error('discovery failed'))

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/sign-out',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/')
  })

  test('POST /sign-out works even without a signed-in session', async () => {
    const homeResponse = await server.inject({ method: 'GET', url: '/' })
    const cookies = mergeCookies({}, homeResponse)

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/sign-out',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe(
      'https://login.microsoftonline.com/tenant/oauth2/v2.0/logout'
    )
  })
})

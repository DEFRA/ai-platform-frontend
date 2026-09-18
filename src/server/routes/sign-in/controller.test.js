import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  completeOidcLogin,
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
      url: '/sign-in?returnTo=%2Fconnect-model'
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/auth/login?returnTo=%2Fconnect-model')
  })

  test('GET /sign-in/team redirects to /sign-in when there is no pending Entra ID identity', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/sign-in/team'
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/sign-in')
  })

  test('GET /sign-in/team renders a form pre-filled with the Entra ID identity', async () => {
    const cookies = await completeOidcLogin(server)

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/sign-in/team',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('test.user@defra.gov.uk'))
  })

  test('POST /sign-in/team with a team name signs the user in and redirects', async () => {
    const cookies = await completeOidcLogin(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        user: {
          _id: 'user-2',
          email: 'test.user@defra.gov.uk',
          displayName: 'Test User'
        },
        team: { _id: 'team-2', name: 'Platform Team' }
      })
    )

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/sign-in/team',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, teamName: 'Platform Team' }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/connect-model')
  })
})



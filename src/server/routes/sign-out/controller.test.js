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

  test('POST /sign-out ends the whole session, so a half-made journey is not there for the next person', async () => {
    const cookies = await signInViaOidc(server, fetchMock)
    const headers = { cookie: cookieHeader(cookies) }
    const models = {
      items: [
        { slug: 'gpt-4o', displayName: 'GPT-4o', researchAvailable: true }
      ]
    }

    fetchMock.mockResponseOnce(JSON.stringify(models))
    const started = await server.inject({
      method: 'GET',
      url: '/connect/shared/start?modelSlug=gpt-4o',
      headers
    })

    expect(started.statusCode).toBe(302)

    fetchMock.mockResponseOnce(JSON.stringify(models))
    const before = await server.inject({
      method: 'GET',
      url: '/connect/shared/model',
      headers
    })

    expect(before.result).toContain('checked')

    await server.inject({
      method: 'POST',
      url: '/sign-out',
      headers,
      payload: { crumb: cookies.crumb }
    })

    // The old session is gone server-side, even for a cookie that was kept:
    // signing in again on it finds nothing of the earlier journey.
    fetchMock.mockResponseOnce(
      JSON.stringify({
        user: {
          _id: 'user-2',
          email: 'someone.else@defra.gov.uk',
          displayName: 'Someone Else'
        },
        team: null
      })
    )
    const jar = { ...cookies }
    mergeCookies(
      jar,
      await server.inject({ method: 'GET', url: '/auth/login', headers })
    )
    mergeCookies(
      jar,
      await server.inject({
        method: 'GET',
        url: '/auth/callback?code=abc&state=state-123',
        headers: { cookie: cookieHeader(jar) }
      })
    )

    const after = await server.inject({
      method: 'GET',
      url: '/connect/shared/model',
      headers: { cookie: cookieHeader(jar) }
    })

    expect(after.statusCode).toBe(302)
    expect(after.headers.location).toBe('/models')
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

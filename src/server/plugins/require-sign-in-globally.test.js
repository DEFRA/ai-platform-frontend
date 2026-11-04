import createFetchMock from 'vitest-fetch-mock'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { noStoreWhenSignedIn } from './require-sign-in-globally.js'
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
    access_token: 'user-access-token',
    refresh_token: 'user-refresh-token',
    expires_in: 3600,
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  })),
  // The access token lasts an hour, so a person active over 8 hours refreshes it.
  refreshTokenGrant: vi.fn(async () => ({
    access_token: 'refreshed-access-token',
    refresh_token: 'refreshed-refresh-token',
    expires_in: 3600
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

  test('allows the Models pages without a session, but sends the start of a journey to sign in, keeping the model', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const models = await server.inject({ method: 'GET', url: '/models' })
    expect(models.statusCode).toBe(statusCodes.ok)

    const start = await server.inject({
      method: 'GET',
      url: '/connect/team/start?modelSlug=gpt-4o'
    })
    expect(start.statusCode).toBe(302)
    expect(start.headers.location).toBe(
      '/sign-in?returnTo=%2Fconnect%2Fteam%2Fstart%3FmodelSlug%3Dgpt-4o'
    )
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
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
  })
})

describe('#requireSignInGlobally session limits', () => {
  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE
  const START = Date.parse('2026-11-04T09:00:00Z')
  let server

  beforeAll(async () => {
    server = await createServer()
    // A page that follows a change: the person loads it, a script then asks
    // for its status on its own (`?fragment=status`) every few seconds.
    server.route({
      method: 'GET',
      path: '/test-wait',
      handler: () => 'ok'
    })
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    // Only the clock moves: timers the server and its cache use keep running.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function signIn() {
    return signInViaOidc(server, fetchMock)
  }

  async function get(url, cookies) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
    })
  }

  function after(ms) {
    vi.setSystemTime(START + ms)
  }

  test('keeps a person signed in at 29 minutes idle', async () => {
    const cookies = await signIn()

    after(29 * MINUTE)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const { statusCode } = await get('/models', cookies)

    expect(statusCode).toBe(statusCodes.ok)
  })

  test('signs a person out at 31 minutes idle, to the signed-out page naming the reason and the page they wanted', async () => {
    const cookies = await signIn()

    after(31 * MINUTE)
    const { statusCode, headers } = await get('/manage?tab=models', cookies)

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(
      '/signed-out?reason=idle&returnTo=%2Fmanage%3Ftab%3Dmodels'
    )
  })

  test('ends the session when it signs the person out, so the cookie finds nothing', async () => {
    const cookies = await signIn()

    after(31 * MINUTE)
    await get('/manage', cookies)
    after(32 * MINUTE)
    const { headers } = await get('/manage', cookies)

    expect(headers.location).toBe('/sign-in?returnTo=%2Fmanage')
  })

  test('a request restarts the idle time', async () => {
    const cookies = await signIn()
    fetchMock.mockResponse(JSON.stringify({ items: [] }))

    after(29 * MINUTE)
    await get('/models', cookies)
    after(58 * MINUTE)
    const { statusCode } = await get('/models', cookies)

    expect(statusCode).toBe(statusCodes.ok)
  })

  test('ends the session 8 hours after sign-in however active the person has been', async () => {
    const cookies = await signIn()
    fetchMock.mockResponse(JSON.stringify({ items: [] }))

    for (let minutes = 29; minutes < 8 * 60; minutes += 29) {
      after(minutes * MINUTE)
      const { statusCode } = await get('/models', cookies)
      expect(statusCode).toBe(statusCodes.ok)
    }

    after(8 * HOUR)
    const { headers } = await get('/manage', cookies)

    expect(headers.location).toBe(
      '/signed-out?reason=expired&returnTo=%2Fmanage'
    )
  }, 30000)

  test('shows a page open to everyone as signed out once the session has ended', async () => {
    const cookies = await signIn()

    after(31 * MINUTE)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const { statusCode, payload } = await get('/models', cookies)

    expect(statusCode).toBe(statusCodes.ok)
    expect(payload).toContain('Sign in')
    expect(payload).not.toContain('Signed in as')
  })

  test('asking how long is left does not restart the idle time', async () => {
    const cookies = await signIn()

    after(29 * MINUTE)
    const status = await get('/session/status', cookies)
    after(31 * MINUTE)
    const { headers } = await get('/manage', cookies)

    expect(status.statusCode).toBe(statusCodes.ok)
    expect(headers.location).toBe('/signed-out?reason=idle&returnTo=%2Fmanage')
  })

  test('a page following a change, polling for its status in the background, does not restart the idle time', async () => {
    const cookies = await signIn()

    for (const minutes of [5, 10, 15, 20, 25, 29]) {
      after(minutes * MINUTE)
      const poll = await get('/test-wait?fragment=status', cookies)
      expect(poll.statusCode).toBe(statusCodes.ok)
    }
    after(31 * MINUTE)
    const { headers } = await get('/test-wait', cookies)

    expect(headers.location).toBe(
      '/signed-out?reason=idle&returnTo=%2Ftest-wait'
    )
  })

  test('the same page asked for by the person (no fragment) does restart the idle time', async () => {
    const cookies = await signIn()

    after(29 * MINUTE)
    await get('/test-wait', cookies)
    after(58 * MINUTE)
    const { statusCode } = await get('/test-wait', cookies)

    expect(statusCode).toBe(statusCodes.ok)
  })

  test('a background poll after the session has ended still gets the signed-out answer, so the poll stops', async () => {
    const cookies = await signIn()

    after(31 * MINUTE)
    const poll = await get('/test-wait?fragment=status', cookies)

    expect(poll.statusCode).toBe(statusCodes.found)
    expect(poll.headers.location).toContain('/signed-out?reason=idle')
  })

  test('an ended session never reaches route validation, so an invalid payload makes no backend call (review thread zwnJr)', async () => {
    const cookies = await signIn()
    fetchMock.resetMocks()

    after(31 * MINUTE)
    // A valid CSRF token and no confirmRevoke: validation would fail, and the
    // route's failAction would then look the credential up in the backend.
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/signed-out?reason=idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('tells the browser not to keep a signed-in page', async () => {
    const cookies = await signIn()

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const page = await get('/models', cookies)
    const missing = await get('/signed-out?reason=banana', cookies)

    expect(page.headers['cache-control']).toBe('no-store')
    expect(missing.statusCode).toBe(statusCodes.badRequest)
    expect(missing.headers['cache-control']).toBe('no-store')
  })

  test('does not forbid caching for a signed-out visitor', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const page = await server.inject({ method: 'GET', url: '/models' })

    expect(page.headers['cache-control']).not.toBe('no-store')
  })

  test('does not forbid caching for static files, even signed in', () => {
    const header = vi.fn()
    const request = {
      path: `${config.get('assetPath')}/stylesheets/app.css`,
      yar: { get: () => ({ id: 'user-1' }) },
      response: { header }
    }

    const outcome = noStoreWhenSignedIn(request, { continue: 'continue' })

    expect(outcome).toBe('continue')
    expect(header).not.toHaveBeenCalled()
  })

  test('leaves an error response it cannot add a header to', () => {
    const request = {
      path: '/boom',
      yar: { get: () => ({ id: 'user-1' }) },
      response: { isBoom: true }
    }

    expect(noStoreWhenSignedIn(request, { continue: 'continue' })).toBe(
      'continue'
    )
  })
})

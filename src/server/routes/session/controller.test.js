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
    () => new URL('https://login.microsoftonline.com/tenant/authorize')
  ),
  authorizationCodeGrant: vi.fn(async () => ({
    access_token: 'user-access-token',
    refresh_token: 'user-refresh-token',
    expires_in: 3600,
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const MINUTE = 60 * 1000
const START = Date.parse('2026-11-04T09:00:00Z')

describe('#sessionController', () => {
  let server
  let cookies

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    fetchMock.resetMocks()
    // Only the clock moves: timers the server and its cache use keep running.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    cookies = await signInViaOidc(server, fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function status() {
    return server.inject({
      method: 'GET',
      url: '/session/status',
      headers: { cookie: cookieHeader(cookies) }
    })
  }

  function extend(payload = { crumb: cookies.crumb }) {
    return server.inject({
      method: 'POST',
      url: '/session/extend',
      headers: { cookie: cookieHeader(cookies) },
      payload
    })
  }

  test('GET /session/status says how many seconds are left on each limit and when the warning shows', async () => {
    vi.setSystemTime(START + 10 * MINUTE)

    const { statusCode, result } = await status()

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual({
      idleSeconds: 20 * 60,
      maxAgeSeconds: 8 * 60 * 60 - 10 * 60,
      warningSeconds: 120
    })
  })

  test('GET /session/status is not kept by a browser', async () => {
    const { headers } = await status()

    expect(headers['cache-control']).toBe('no-store')
  })

  test('GET /session/status sends a signed-out visitor to sign in', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/session/status'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/sign-in?returnTo=%2Fsession%2Fstatus')
  })

  test('POST /session/extend restarts the idle time and answers with the new times', async () => {
    vi.setSystemTime(START + 29 * MINUTE)

    const { statusCode, result } = await extend()

    expect(statusCode).toBe(statusCodes.ok)
    expect(result.idleSeconds).toBe(30 * 60)
    expect(result.maxAgeSeconds).toBe(8 * 60 * 60 - 29 * 60)

    vi.setSystemTime(START + 58 * MINUTE)
    const later = await status()
    expect(later.result.idleSeconds).toBe(60)
  })

  test('POST /session/extend cannot move the 8 hour limit', async () => {
    for (let minutes = 29; minutes < 7 * 60 + 59; minutes += 29) {
      vi.setSystemTime(START + minutes * MINUTE)
      await extend()
    }
    vi.setSystemTime(START + (7 * 60 + 59) * MINUTE)

    const { result } = await extend()

    expect(result.idleSeconds).toBe(30 * 60)
    expect(result.maxAgeSeconds).toBe(60)
  })

  test('POST /session/extend needs the CSRF token', async () => {
    const { statusCode } = await extend({})

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('a signed-in page carries the closed timeout dialog with the time left, a signed-out page does not', async () => {
    fetchMock.mockResponse(JSON.stringify({ items: [] }))
    vi.setSystemTime(START + 10 * MINUTE)

    const signedIn = await server.inject({
      method: 'GET',
      url: '/models',
      headers: { cookie: cookieHeader(cookies) }
    })
    const signedOut = await server.inject({ method: 'GET', url: '/models' })

    expect(signedIn.payload).toContain('data-module="app-session-timeout"')
    expect(signedIn.payload).toContain('data-idle-seconds="1800"')
    expect(signedIn.payload).toContain(
      `data-max-age-seconds="${8 * 60 * 60 - 10 * 60}"`
    )
    expect(signedIn.payload).toContain(`value="${cookies.crumb}"`)
    expect(signedOut.payload).not.toContain('app-session-timeout')
  })

  test('POST /session/extend does not keep a session that has already ended', async () => {
    vi.setSystemTime(START + 31 * MINUTE)

    const { statusCode, headers } = await extend()

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/signed-out?reason=idle')
  })
})

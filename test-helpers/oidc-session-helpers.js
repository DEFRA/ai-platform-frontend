/**
 * Shared helpers for driving the mocked Entra ID (OIDC) sign-in flow in tests.
 * Consuming test files must still add the `openid-client` / oidc-client.js
 * `vi.mock` blocks themselves (Vitest hoists mocks per-file).
 */

export function extractSetCookies(response) {
  const setCookie = response.headers['set-cookie']
  return Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
}

export function mergeCookies(jar, response) {
  for (const cookie of extractSetCookies(response)) {
    const [pair] = cookie.split(';')
    const [name, ...rest] = pair.split('=')
    jar[name] = rest.join('=')
  }
  return jar
}

export function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

// Drives GET /auth/login -> GET /auth/callback (both mocked), which upserts
// the user via the backend API and signs them straight in - there is no
// separate team step. Callers must mock the POST /v1/users response on
// fetchMock before calling this (see signInViaOidc for the common case).
export async function completeOidcLogin(server) {
  const loginResponse = await server.inject({
    method: 'GET',
    url: '/auth/login'
  })
  const cookies = mergeCookies({}, loginResponse)

  const callbackResponse = await server.inject({
    method: 'GET',
    url: '/auth/callback?code=abc&state=state-123',
    headers: { cookie: cookieHeader(cookies) }
  })

  return mergeCookies(cookies, callbackResponse)
}

// Completes the full sign-in journey (Entra ID + backend user upsert) and
// returns the authenticated session's cookie jar for use by subsequent
// server.inject calls.
export async function signInViaOidc(server, fetchMock) {
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

  return completeOidcLogin(server)
}

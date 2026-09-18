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

// Drives GET /auth/login -> GET /auth/callback (both mocked) so the session
// ends up with a pending Entra ID identity, ready for /sign-in/team.
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

// Completes the full sign-in journey (Entra + team name) and returns the
// authenticated session's cookie jar for use by subsequent server.inject calls.
export async function signInViaOidc(server, fetchMock, { teamName } = {}) {
  const cookies = await completeOidcLogin(server)

  fetchMock.mockResponseOnce(
    JSON.stringify({
      user: {
        _id: 'user-1',
        email: 'test.user@defra.gov.uk',
        displayName: 'Test User'
      },
      team: { _id: 'team-1', name: teamName ?? 'Platform Team' }
    })
  )

  const postTeam = await server.inject({
    method: 'POST',
    url: '/sign-in/team',
    headers: { cookie: cookieHeader(cookies) },
    payload: { crumb: cookies.crumb, teamName: teamName ?? 'Platform Team' }
  })

  return mergeCookies(cookies, postTeam)
}

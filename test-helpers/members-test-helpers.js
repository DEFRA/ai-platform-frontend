import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import { sampleTeam } from '#/test-helpers/team-connect-helpers.js'

/**
 * Shared fixtures and steps for the tests of the Members tab and the pages
 * behind it, driven through `server.inject` with the backend mocked on
 * `fetchMock`. The consuming file adds the `openid-client` and oidc-client.js
 * `vi.mock` blocks itself (Vitest hoists mocks per file).
 */

export const TEAM_PATH = `/v1/teams/${sampleTeam.slug}`
export const TEAM_URL = `/teams/${sampleTeam.slug}`
export const MEMBERS_URL = `${TEAM_URL}/members`
export const NOT_FOUND = reply(404, { code: 'not-found', message: 'Not Found' })

export const you = (role) => ({
  _id: 'member-1',
  userId: 'user-1',
  displayName: 'Test User',
  email: 'test.user@defra.gov.uk',
  role,
  status: 'active'
})
export const priya = (role = 'admin') => ({
  _id: 'member-2',
  userId: 'user-2',
  displayName: 'Priya Raman',
  email: 'priya.raman@defra.gov.uk',
  role,
  status: 'active'
})
export const tom = {
  _id: 'member-3',
  userId: 'user-3',
  displayName: 'Tom Ellis',
  email: 'tom.ellis@defra.gov.uk',
  role: 'user',
  status: 'active'
}

/**
 * @param {object} options
 * @param {import('vitest-fetch-mock').FetchMock} options.fetchMock
 * @param {() => import('@hapi/hapi').Server} options.getServer The server the
 *   file started, read when a step runs (it starts in `beforeAll`).
 * @param {() => Record<string, string>} options.getCookies The signed-in
 *   session's cookie jar, read when a step runs (a test may replace it).
 */
export function membersHelpers({ fetchMock, getServer, getCookies }) {
  // The signed-in person is a member or an admin of the team, with Priya an
  // admin and Tom a member; or (no role) is not in the team at all, which the
  // backend answers as not found.
  function backend(role, extra = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: role
        ? {
            team: sampleTeam,
            members: [you(role), priya(), tom],
            environments: []
          }
        : NOT_FOUND,
      'GET /v1/teams': { items: [] },
      ...extra
    })
  }

  function get(url, jar = getCookies()) {
    return getServer().inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(jar) }
    })
  }

  function post(url, payload = {}) {
    return getServer().inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(getCookies()) },
      payload: { crumb: getCookies().crumb, ...payload }
    })
  }

  // Follows a redirect with the session the response set, as the browser does.
  function follow(response) {
    return get(
      response.headers.location,
      mergeCookies({ ...getCookies() }, response)
    )
  }

  function writes() {
    return fetchMock.mock.calls.filter(
      ([url, options]) =>
        url.includes('/v1/teams') &&
        !url.includes('/people/search') &&
        options?.method &&
        options.method !== 'GET'
    )
  }

  return { backend, get, post, follow, writes }
}

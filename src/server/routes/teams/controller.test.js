import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
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
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const sampleTeam = { _id: 'team-1', name: 'Flood Risk Team', verified: false }

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
}

describe('#teamsController', () => {
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

  test('GET /teams redirects to /sign-in when signed out', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/teams'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/sign-in?returnTo=%2Fteams')
  })

  test('GET /teams lists the teams for the signed-in user', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleTeam] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/teams',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Flood Risk Team'))
  })

  test('GET /teams shows the empty state', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('You are not a member of a team yet')
    )
  })

  test('POST /teams/new with an invalid name re-renders the form with errors', async () => {
    const cookies = await signIn(server)

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/teams/new',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, name: 'ab' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('POST /teams/new -> GET check -> POST check creates the team', async () => {
    let cookies = await signIn(server)

    const postNew = await server.inject({
      method: 'POST',
      url: '/teams/new',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, name: 'Flood Risk Team' }
    })
    cookies = mergeCookies(cookies, postNew)
    expect(postNew.statusCode).toBe(statusCodes.seeOther)
    expect(postNew.headers.location).toBe('/teams/new/check')

    const getCheck = await server.inject({
      method: 'GET',
      url: '/teams/new/check',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCheck)
    expect(getCheck.result).toEqual(expect.stringContaining('Flood Risk Team'))

    fetchMock.mockResponseOnce(JSON.stringify({ team: sampleTeam }))

    const postCheck = await server.inject({
      method: 'POST',
      url: '/teams/new/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postCheck.statusCode).toBe(statusCodes.seeOther)
    expect(postCheck.headers.location).toBe('/teams/team-1')
  })

  test('POST /teams/new/check shows an error for a duplicate team name', async () => {
    let cookies = await signIn(server)

    const postNew = await server.inject({
      method: 'POST',
      url: '/teams/new',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, name: 'Duplicate Team' }
    })
    cookies = mergeCookies(cookies, postNew)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 409,
        error: 'Conflict',
        message: 'A team with this name already exists',
        code: 'team-exists'
      }),
      { status: 409 }
    )

    const postCheck = await server.inject({
      method: 'POST',
      url: '/teams/new/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postCheck.statusCode).toBe(statusCodes.conflict)
    expect(postCheck.result).toEqual(
      expect.stringContaining('A team with this name already exists')
    )
  })

  test('GET /teams/{id} shows an admin the add member form', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [{ userId: 'user-1', role: 'admin', status: 'active' }]
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Add a member'))
  })

  test('GET /teams/{id} hides the add member form from a non-admin', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [{ userId: 'user-1', role: 'user', status: 'active' }]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).not.toEqual(expect.stringContaining('Add a member'))
  })

  test('GET /teams/{id} shows a not found page for a non-member', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 404,
        error: 'Not Found',
        message: 'Not Found'
      }),
      { status: 404 }
    )

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/teams/unknown-team',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Team not found'))
  })

  test('POST /teams/{id}/members adds a member and redirects back to the team', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        member: {
          email: 'invitee@defra.gov.uk',
          role: 'user',
          status: 'invited'
        }
      })
    )

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/teams/team-1/members',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, email: 'invitee@defra.gov.uk' }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/teams/team-1')
  })

  test('POST /teams/{id}/members silently redirects back for a non-admin (403)', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Only a team admin can add members',
        code: 'admin-required'
      }),
      { status: 403 }
    )

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/teams/team-1/members',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, email: 'invitee@defra.gov.uk' }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/teams/team-1')
  })
})

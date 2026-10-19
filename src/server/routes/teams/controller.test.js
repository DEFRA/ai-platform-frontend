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

const sampleTeam = {
  _id: 'team-1',
  name: 'Flood Risk Team',
  slug: 'flood-risk-team',
  verified: false
}

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
      payload: { crumb: cookies.crumb, name: 'ab', serviceCode: 'ABC' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('POST /teams/new asks for a service code of three letters or numbers', async () => {
    const cookies = await signIn(server)

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/teams/new',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, name: 'No Code Team', serviceCode: '' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('Enter your service code')
  })

  test('POST /teams/new -> GET check -> POST check creates the team', async () => {
    let cookies = await signIn(server)

    const postNew = await server.inject({
      method: 'POST',
      url: '/teams/new',
      headers: { cookie: cookieHeader(cookies) },
      payload: {
        crumb: cookies.crumb,
        name: 'Flood Risk Team',
        serviceCode: 'aip'
      }
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
    expect(getCheck.result).toContain('aip')

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
      payload: {
        crumb: cookies.crumb,
        name: 'Duplicate Team',
        serviceCode: 'ABC'
      }
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
    expect(result).toContain(
      'Removing someone does not change the team client secret.'
    )
    expect(result).not.toContain('team key')
  })

  test('GET /teams/{id} shows the team ID and says it cannot be changed', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [{ userId: 'user-1', role: 'admin', status: 'active' }]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('Team ID')
    expect(result).toContain('flood-risk-team')
    expect(result).toContain('cannot be changed')
  })

  test('POST /teams/{id}/service-code saves a new code and returns to the team', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ team: { ...sampleTeam, serviceCode: 'XYZ' } })
    )

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/teams/team-1/service-code',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, serviceCode: 'xyz' }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/teams/team-1')

    const [url, options] = fetchMock.mock.calls.at(-1)

    expect(url).toContain('/v1/teams/team-1')
    expect(options).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(options.body)).toEqual({ serviceCode: 'xyz' })
  })

  test('POST /teams/{id}/service-code re-renders the team page for an invalid code, keeping what was typed in the input and the saved code in the summary', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: { ...sampleTeam, serviceCode: 'OLD' },
        members: [{ userId: 'user-1', role: 'admin', status: 'active' }]
      })
    )

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/teams/team-1/service-code',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, serviceCode: 'TOO-LONG' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain(
      'Service code must be 3 letters or numbers, for example AIP'
    )
    expect(result).toMatch(/name="serviceCode"[^>]*value="TOO-LONG"/)
    expect(result).toContain('OLD')
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

  test('GET /teams/{id} masks other members\u2019 email addresses from a non-admin', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [
          { userId: 'user-1', role: 'user', status: 'active' },
          {
            userId: 'user-2',
            email: 'colleague@defra.gov.uk',
            role: 'user',
            status: 'active'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).not.toEqual(
      expect.stringContaining('colleague@defra.gov.uk')
    )
    expect(result).toEqual(expect.stringContaining('@defra.gov.uk'))
  })

  test('GET /teams/{id} hides a member email that is not an address at all from a non-admin', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [
          { userId: 'user-1', role: 'user', status: 'active' },
          {
            userId: 'user-2',
            email: 'not-an-address',
            role: 'user',
            status: 'active'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('Hidden')
    expect(result).not.toContain('not-an-address')
  })

  test('GET /teams/{id} shows full email addresses to an admin', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [
          { userId: 'user-1', role: 'admin', status: 'active' },
          {
            userId: 'user-2',
            email: 'colleague@defra.gov.uk',
            role: 'user',
            status: 'active'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(expect.stringContaining('colleague@defra.gov.uk'))
  })

  test('GET /teams/{id} shows a member\u2019s display name and hides removed members', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [
          { userId: 'user-1', role: 'admin', status: 'active' },
          {
            _id: 'member-2',
            userId: 'user-2',
            email: 'colleague@defra.gov.uk',
            displayName: 'Colleague Name',
            role: 'user',
            status: 'active'
          },
          {
            _id: 'member-3',
            userId: 'user-3',
            email: 'gone@defra.gov.uk',
            displayName: 'Gone Already',
            role: 'user',
            status: 'removed'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(expect.stringContaining('Colleague Name'))
    expect(result).not.toEqual(expect.stringContaining('Gone Already'))
  })

  test('GET /teams/{id} shows Remove for an admin, but not for the sole admin\u2019s own row', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [
          {
            _id: 'member-1',
            userId: 'user-1',
            role: 'admin',
            status: 'active'
          },
          {
            _id: 'member-2',
            userId: 'user-2',
            email: 'colleague@defra.gov.uk',
            role: 'user',
            status: 'active'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('/teams/team-1/members/member-2/remove')
    )
    expect(result).not.toEqual(
      expect.stringContaining('/teams/team-1/members/member-1/remove')
    )
  })

  test('GET /teams/{id} offers a role change for a member, but not for the sole admin', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [
          {
            _id: 'member-1',
            userId: 'user-1',
            role: 'admin',
            status: 'active'
          },
          {
            _id: 'member-2',
            userId: 'user-2',
            email: 'colleague@defra.gov.uk',
            role: 'user',
            status: 'active'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('/teams/team-1/members/member-2/role')
    expect(result).toContain('Make an admin')
    expect(result).not.toContain('/teams/team-1/members/member-1/role')
  })

  test('POST /teams/{id}/members/{memberId}/role sends the new role and returns to the team', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ member: { _id: 'member-2', role: 'admin' } })
    )

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/teams/team-1/members/member-2/role',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, role: 'admin' }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/teams/team-1')

    const [url, options] = fetchMock.mock.calls.at(-1)

    expect(url).toContain('/v1/teams/team-1/members/member-2')
    expect(options).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(options.body)).toEqual({ role: 'admin' })
  })

  test('POST /teams/{id}/members/{memberId}/role shows a banner when the last admin cannot be demoted', async () => {
    let cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 409,
        error: 'Conflict',
        message: 'A team must keep at least one admin',
        code: 'last-admin'
      }),
      { status: 409 }
    )

    const demote = await server.inject({
      method: 'POST',
      url: '/teams/team-1/members/member-1/role',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, role: 'user' }
    })
    cookies = mergeCookies(cookies, demote)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [{ userId: 'user-1', role: 'admin', status: 'active' }]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('A team must keep at least one admin.')
  })

  test('GET /teams marks the team the person is acting in after they open it', async () => {
    let cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [{ userId: 'user-1', role: 'admin', status: 'active' }]
      })
    )

    const openTeam = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, openTeam)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          { _id: 'team-1', name: 'Flood Risk Team' },
          { _id: 'team-2', name: 'Coastal Team' }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('Acting in this team')
    expect(result.indexOf('Flood Risk Team')).toBeLessThan(
      result.indexOf('Acting in this team')
    )
  })

  test('POST /teams/{id}/members/{memberId}/remove removes a member and redirects back', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(null, { status: 204 })

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/teams/team-1/members/member-2/remove',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe('/teams/team-1')
  })

  test('POST /teams/{id}/members/{memberId}/remove shows a banner when the last admin cannot be removed', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 409,
        error: 'Conflict',
        message: 'A team must keep at least one admin',
        code: 'last-admin'
      }),
      { status: 409 }
    )

    const postRemove = await server.inject({
      method: 'POST',
      url: '/teams/team-1/members/member-1/remove',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postRemove.statusCode).toBe(statusCodes.seeOther)

    const redirectCookies = mergeCookies(cookies, postRemove)
    fetchMock.mockResponseOnce(
      JSON.stringify({
        team: sampleTeam,
        members: [
          { _id: 'member-1', userId: 'user-1', role: 'admin', status: 'active' }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/teams/team-1',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('A team must keep at least one admin')
    )
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

  describe('the team’s models', () => {
    const adminTeam = {
      team: sampleTeam,
      members: [{ userId: 'user-1', role: 'admin', status: 'active' }]
    }
    const memberTeam = {
      team: sampleTeam,
      members: [
        { userId: 'user-1', role: 'user', status: 'active' },
        { userId: 'user-2', role: 'admin', status: 'active' }
      ]
    }
    const catalogue = {
      items: [
        { slug: 'gpt-4o', displayName: 'GPT-4o' },
        { slug: 'gpt-5-nano', displayName: 'GPT-5 nano' }
      ]
    }

    function deployment(overrides = {}) {
      return {
        _id: 'dep-1',
        teamId: 'team-1',
        environment: 'infradev',
        modelSlug: 'gpt-4o',
        status: 'active',
        failureReason: null,
        links: {},
        ...overrides
      }
    }

    // The team page reads the team, then its deployments and the catalogue.
    function mockTeamPage(team, deployments) {
      fetchMock.mockResponseOnce(JSON.stringify(team))
      fetchMock.mockResponseOnce(JSON.stringify({ items: deployments }))
      fetchMock.mockResponseOnce(JSON.stringify(catalogue))
    }

    test('GET /teams/{id} lists the models with a Remove link for an admin on an active one', async () => {
      const cookies = await signIn(server)
      mockTeamPage(adminTeam, [
        deployment(),
        deployment({
          _id: 'dep-2',
          modelSlug: 'gpt-5-nano',
          status: 'deploying'
        }),
        deployment({ _id: 'dep-3', modelSlug: 'gpt-5-nano', status: 'removed' })
      ])

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('data-testid="team-models"')
      expect(result).toContain('GPT-4o')
      expect(result).toContain('Ready to use')
      expect(result).toContain('Setting up')
      expect(result).toContain('Removed')
      expect(result).toContain('href="/teams/team-1/models/dep-1/remove"')
      expect(result).toContain('href="/connect/team/request/team-1/dep-2"')
      expect(result).not.toContain('/models/dep-2/remove')
      expect(result).not.toContain('/models/dep-3/remove')
      // Something is still changing: the page offers a refresh rather than
      // reloading itself under the forms.
      expect(result).toContain('data-testid="team-models-changing"')
      expect(result).toContain('Refresh this page')
      expect(result).not.toContain('http-equiv="refresh"')
    })

    test('GET /teams/{id} offers "See what happened" for a failed model and no link for an unknown status', async () => {
      const cookies = await signIn(server)
      mockTeamPage(adminTeam, [
        deployment({ _id: 'dep-f', status: 'deploy-failed' }),
        deployment({ _id: 'dep-u', status: 'brand-new-status' })
      ])

      const { result } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(result).toContain('Setup failed')
      expect(result).toContain('See what happened')
      expect(result).toContain('href="/connect/team/request/team-1/dep-f"')
      expect(result).toContain('Status unknown')
      expect(result).not.toContain('Setting up')
      expect(result).not.toContain('Check progress')
      expect(result).not.toContain('/connect/team/request/team-1/dep-u')
    })

    test('GET /teams/{id} lists what was set up for an active model, by name and kind, with the registration state', async () => {
      const cookies = await signIn(server)
      mockTeamPage(adminTeam, [
        deployment({
          resources: [
            { name: 'aip-alpha', kind: 'Foundry project', verified: true },
            { name: 'alpha-gpt-4o', kind: 'Model deployment', verified: true }
          ],
          appRegistration: 'skipped'
        })
      ])

      const { result } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(result).toContain('data-testid="model-resources"')
      expect(result).toContain('Foundry project')
      expect(result).toContain('aip-alpha')
      expect(result).toContain('alpha-gpt-4o')
      expect(result).toContain('Skipped, awaiting Entra consent')
    })

    test('GET /teams/{id} lists nothing for a model that is not active yet', async () => {
      const cookies = await signIn(server)
      mockTeamPage(adminTeam, [
        deployment({
          status: 'deployed',
          resources: [
            { name: 'aip-alpha', kind: 'Foundry project', verified: false }
          ],
          appRegistration: 'skipped'
        })
      ])

      const { result } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(result).not.toContain('data-testid="model-resources"')
      expect(result).not.toContain('aip-alpha')
    })

    test('GET /teams/{id} names a model by its slug when the catalogue no longer lists it', async () => {
      const cookies = await signIn(server)
      mockTeamPage(adminTeam, [deployment({ modelSlug: 'retired-model' })])

      const { result } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(result).toContain('retired-model')
    })

    test('GET /teams/{id}/models/{deploymentId}/remove fails rather than hiding a team lookup that broke', async () => {
      const cookies = await signIn(server)
      fetchMock.mockResponseOnce(
        JSON.stringify({ statusCode: 502, message: 'down' }),
        { status: 502 }
      )

      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/teams/team-1/models/dep-1/remove',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('GET /teams/{id} shows a member the models without a Remove link', async () => {
      const cookies = await signIn(server)
      mockTeamPage(memberTeam, [deployment()])

      const { result } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(result).toContain('GPT-4o')
      expect(result).not.toContain('/models/dep-1/remove')
      expect(result).not.toContain('data-testid="team-models-changing"')
    })

    test('GET /teams/{id} says so when the models cannot be listed, rather than showing an empty team', async () => {
      const cookies = await signIn(server)
      fetchMock.mockResponseOnce(JSON.stringify(adminTeam))
      fetchMock.mockResponseOnce(
        JSON.stringify({ statusCode: 502, message: 'down' }),
        { status: 502 }
      )
      fetchMock.mockResponseOnce(JSON.stringify(catalogue))

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('data-testid="team-models-unavailable"')
      expect(result).toContain('Try again')
      expect(result).not.toContain('This team has no models yet')
      // The rest of the team page still works.
      expect(result).toContain('Add a member')
    })

    test('GET /teams/{id}/models/{deploymentId}/remove is not found when the team is', async () => {
      const cookies = await signIn(server)
      fetchMock.mockResponseOnce(
        JSON.stringify({ statusCode: 404, message: 'Not Found' }),
        { status: 404 }
      )

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/teams/team-9/models/dep-1/remove',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Model not found')
    })

    test('GET /teams/{id}/models/{deploymentId}/remove asks an admin to confirm', async () => {
      const cookies = await signIn(server)
      mockTeamPage(adminTeam, [deployment()])

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/teams/team-1/models/dep-1/remove',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Remove GPT-4o from Flood Risk Team?')
      expect(result).toContain(
        'will stop working as soon as it has been removed'
      )
      expect(result).toContain('data-testid="remove-model-confirm"')
      expect(result).toContain('href="/teams/team-1"')
    })

    test.each([
      ['a member', memberTeam, 'dep-1'],
      ['an unknown model', adminTeam, 'dep-9']
    ])(
      'GET /teams/{id}/models/{deploymentId}/remove is not found for %s',
      async (_, team, deploymentId) => {
        const cookies = await signIn(server)
        mockTeamPage(team, [deployment()])

        const { result, statusCode } = await server.inject({
          method: 'GET',
          url: `/teams/team-1/models/${deploymentId}/remove`,
          headers: { cookie: cookieHeader(cookies) }
        })

        expect(statusCode).toBe(statusCodes.notFound)
        expect(result).toContain('Model not found')
      }
    )

    test('POST /teams/{id}/models/{deploymentId}/remove asks the backend to remove it and says it is on its way', async () => {
      const cookies = await signIn(server)
      fetchMock.mockResponseOnce(
        JSON.stringify({ deployment: deployment({ status: 'removing' }) }),
        { status: 202 }
      )

      const posted = await server.inject({
        method: 'POST',
        url: '/teams/team-1/models/dep-1/remove',
        headers: { cookie: cookieHeader(cookies) },
        payload: { crumb: cookies.crumb }
      })

      expect(posted.statusCode).toBe(statusCodes.seeOther)
      expect(posted.headers.location).toBe('/teams/team-1')
      const [url, init] = fetchMock.mock.calls.at(-1)
      expect(url).toContain('/v1/teams/team-1/deployments/dep-1')
      expect(init.method).toBe('DELETE')
      expect(init.headers['x-user-id']).toBeTruthy()

      mockTeamPage(adminTeam, [deployment({ status: 'removing' })])
      const { result } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(mergeCookies(cookies, posted)) }
      })

      expect(result).toContain('gpt-4o is being removed')
      expect(result).toContain('Removing')
      expect(result).not.toContain('/models/dep-1/remove')
    })

    test('POST /teams/{id}/models/{deploymentId}/remove reports a model that was removed at once', async () => {
      const cookies = await signIn(server)
      fetchMock.mockResponseOnce(
        JSON.stringify({ deployment: deployment({ status: 'removed' }) }),
        { status: 200 }
      )

      const posted = await server.inject({
        method: 'POST',
        url: '/teams/team-1/models/dep-1/remove',
        headers: { cookie: cookieHeader(cookies) },
        payload: { crumb: cookies.crumb }
      })

      mockTeamPage(adminTeam, [deployment({ status: 'removed' })])
      const { result } = await server.inject({
        method: 'GET',
        url: '/teams/team-1',
        headers: { cookie: cookieHeader(mergeCookies(cookies, posted)) }
      })

      expect(result).toContain('gpt-4o has been removed from the team.')
    })

    test.each([
      [
        'deployment-in-progress',
        'This model is still being set up. Try again once it is ready.'
      ],
      [
        'team-file-busy',
        'Another change to this team is in progress. Try again in a few minutes.'
      ],
      ['admin-required', 'Only a team admin can remove a model.'],
      ['some-new-code', 'refused']
    ])(
      'POST /teams/{id}/models/{deploymentId}/remove explains a refusal (%s)',
      async (code, message) => {
        const cookies = await signIn(server)
        fetchMock.mockResponseOnce(
          JSON.stringify({ statusCode: 409, message: 'refused', code }),
          { status: code === 'admin-required' ? 403 : 409 }
        )

        const posted = await server.inject({
          method: 'POST',
          url: '/teams/team-1/models/dep-1/remove',
          headers: { cookie: cookieHeader(cookies) },
          payload: { crumb: cookies.crumb }
        })

        expect(posted.statusCode).toBe(statusCodes.seeOther)

        mockTeamPage(adminTeam, [deployment()])
        const { result } = await server.inject({
          method: 'GET',
          url: '/teams/team-1',
          headers: { cookie: cookieHeader(mergeCookies(cookies, posted)) }
        })

        expect(result).toContain(message)
      }
    )

    test('POST /teams/{id}/models/{deploymentId}/remove surfaces an unknown model as not found', async () => {
      const cookies = await signIn(server)
      fetchMock.mockResponseOnce(
        JSON.stringify({ statusCode: 404, message: 'Not Found' }),
        { status: 404 }
      )

      const { statusCode } = await server.inject({
        method: 'POST',
        url: '/teams/team-1/models/dep-9/remove',
        headers: { cookie: cookieHeader(cookies) },
        payload: { crumb: cookies.crumb }
      })

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('POST /teams/{id}/models/{deploymentId}/remove fails rather than hiding a broken backend', async () => {
      const cookies = await signIn(server)
      fetchMock.mockRejectOnce(new Error('connection refused'))

      const { statusCode, result } = await server.inject({
        method: 'POST',
        url: '/teams/team-1/models/dep-1/remove',
        headers: { cookie: cookieHeader(cookies) },
        payload: { crumb: cookies.crumb }
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
      expect(result).not.toContain('connection refused')
    })

    test('GET /teams/{id}/models/{deploymentId}/remove is not found for a member who is not an admin', async () => {
      const cookies = await signIn(server)
      mockTeamPage(memberTeam, [deployment()])

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/teams/team-1/models/dep-1/remove',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Model not found')
    })
  })
})

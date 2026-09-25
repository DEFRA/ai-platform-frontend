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

const sampleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai'
}

const sampleCredential = {
  _id: 'cred-1',
  modelSlug: 'gpt-4o',
  status: 'active',
  keyHint: 'ab12',
  expiresAt: '2026-09-23T00:00:00.000Z',
  renewalCount: 0,
  renewalsRemaining: 3
}

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
}

describe('#manageController', () => {
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

  test('GET /manage redirects to /sign-in when signed out', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/manage'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/sign-in?returnTo=%2Fmanage')
  })

  test('GET /manage lists credentials with model names', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleCredential] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
    expect(result).toEqual(expect.stringContaining('ab12'))
  })

  test('GET /manage still renders when a team deployment lookup fails', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleCredential] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ message: 'boom' }), {
      status: statusCodes.internalServerError
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
    expect(result).toEqual(expect.stringContaining('Flood Risk Team'))
  })

  test('GET /manage shows the empty state with no credentials', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('You do not have any credentials yet')
    )
  })

  test('GET /manage shows a "Your teams" placeholder with no team memberships', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('You are not a member of a team yet')
    )
  })

  test('GET /manage lists a shared team credential under the team section', async () => {
    const cookies = await signIn(server)
    const teamCredential = {
      ...sampleCredential,
      _id: 'cred-team-1',
      teamId: 'team-1',
      tier: 'team'
    }

    fetchMock.mockResponseOnce(JSON.stringify({ items: [teamCredential] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Flood Risk Team'))
    expect(result).toEqual(expect.stringContaining('ab12'))
    expect(result).toEqual(
      expect.stringContaining('You do not have any credentials yet')
    )
  })

  test('GET /manage keeps a research credential personal even when its stamped teamId no longer matches any current team', async () => {
    const cookies = await signIn(server)
    const staleTeamCredential = {
      ...sampleCredential,
      _id: 'cred-stale-team',
      teamId: 'team-old-no-longer-member',
      tier: 'research'
    }

    fetchMock.mockResponseOnce(JSON.stringify({ items: [staleTeamCredential] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toEqual(
      expect.stringContaining('You do not have any credentials yet')
    )
    expect(result).toEqual(expect.stringContaining('ab12'))
    expect(result).toEqual(
      expect.stringContaining('This team does not have any credentials yet')
    )
  })

  test('GET /manage shows a "check progress" link for an in-progress team deployment', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'deployment-1',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            status: 'deploying'
          }
        ]
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Setting up'))
    expect(result).toEqual(
      expect.stringContaining('/connect/team/request/team-1/deployment-1')
    )
  })

  test('GET /manage shows a "setup failed" status for a failed team deployment', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'deployment-2',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            status: 'checks-failed'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(expect.stringContaining('Setup failed'))
  })

  test('GET /manage shows a "ready to view" link for an active deployment with no credential yet', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'deployment-3',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            status: 'active'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(expect.stringContaining('Ready to view'))
    expect(result).toEqual(
      expect.stringContaining('/connect/team/request/team-1/deployment-3')
    )
  })

  test('GET /manage sorts a team with a request in progress before other teams, so a refresh keeps showing it', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          { _id: 'team-1', name: 'Flood Risk Team' },
          { _id: 'team-2', name: 'Coastal Erosion Team' }
        ]
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'deployment-4',
            teamId: 'team-2',
            modelSlug: 'gpt-4o',
            status: 'deploying'
          }
        ]
      })
    )

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result.indexOf('Coastal Erosion Team')).toBeLessThan(
      result.indexOf('Flood Risk Team')
    )
  })

  test('POST /manage/credentials/{id}/renew shows a success banner', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleCredential, renewalCount: 1 })
    )

    const postRenew = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/renew',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postRenew.statusCode).toBe(303)
    expect(postRenew.headers.location).toBe('/manage')

    const redirectCookies = mergeCookies(cookies, postRenew)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(expect.stringContaining('Credential renewed'))
  })

  test('POST /manage/credentials/{id}/renew shows an error banner once the cap is reached', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Renewal cap reached for this credential',
        code: 'renewal-cap-reached'
      }),
      { status: 403 }
    )

    const postRenew = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/renew',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postRenew.statusCode).toBe(303)

    const redirectCookies = mergeCookies(cookies, postRenew)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('Renewal cap reached for this credential')
    )
  })

  test('GET /manage/credentials/{id}/revoke shows the confirm page', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
  })

  test('POST /manage/credentials/{id}/revoke with "no" takes no action', async () => {
    const cookies = await signIn(server)
    fetchMock.mockClear()

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, confirmRevoke: 'no' }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/manage')
    expect(fetchMock.mock.calls).toHaveLength(0)
  })

  test('POST /manage/credentials/{id}/revoke with "yes" revokes and shows a banner', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(null, { status: 204 })

    const postRevoke = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, confirmRevoke: 'yes' }
    })

    expect(postRevoke.statusCode).toBe(303)

    const redirectCookies = mergeCookies(cookies, postRevoke)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(expect.stringContaining('Credential revoked'))
  })

  test('POST /manage/credentials/{id}/revoke rejects an unselected radio', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('GET /manage/credentials/{id}/revoke redirects to /manage for an unknown id', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 404,
        error: 'Not Found',
        message: 'Not Found'
      }),
      { status: 404 }
    )

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/unknown-id/revoke',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/manage')
  })

  test('GET /manage/credentials/{id} shows the persistent detail page', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
    expect(result).toEqual(expect.stringContaining('ab12'))
    expect(result).toEqual(expect.stringContaining('Renew'))
    expect(result).toEqual(expect.stringContaining('Revoke this credential'))
  })

  test('GET /manage/credentials/{id} hides renew/revoke actions for a team credential', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...sampleCredential,
        teamId: 'team-1',
        tier: 'team',
        allowedDeployments: ['gpt-4o']
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk', role: 'user' }] })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('Team (dedicated deployment)')
    )
    expect(result).not.toEqual(
      expect.stringContaining('Revoke this credential')
    )
    expect(result).not.toEqual(
      expect.stringContaining('Rotate this credential')
    )
  })

  test('GET /manage/credentials/{id} shows rotate/revoke actions for a team admin', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...sampleCredential,
        teamId: 'team-1',
        tier: 'team',
        credentialType: 'subscription-key',
        allowedDeployments: ['gpt-4o']
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk', role: 'admin' }] })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(expect.stringContaining('Rotate this credential'))
    expect(result).toEqual(expect.stringContaining('Revoke this credential'))
  })

  test('GET /manage/credentials/{id} shows a red tag for a revoked credential', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleCredential, status: 'revoked' })
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(expect.stringContaining('govuk-tag--red'))
  })

  test('GET /manage/credentials/{id} shows a not found page for an unknown id', async () => {
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
      url: '/manage/credentials/unknown-id',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Credential not found'))
  })
})

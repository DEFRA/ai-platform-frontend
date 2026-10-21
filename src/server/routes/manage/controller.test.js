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

const PLACEHOLDER_NOTICE = 'data-testid="placeholder-credential-notice"'

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

  test('GET /manage lists only the personâ€™s own keys, never a team client secret, which is on the teamâ€™s page', async () => {
    const cookies = await signIn(server)
    const teamCredential = {
      ...sampleCredential,
      _id: 'cred-team',
      teamId: 'team-1',
      tier: 'team',
      credentialType: 'oauth',
      issuerKey: 'mock',
      allowedDeployments: ['gpt-4o'],
      expiresAt: null
    }

    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [sampleCredential, teamCredential] })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result.split('data-testid="keys-table-row"')).toHaveLength(2)
    expect(result).not.toContain('cred-team')
    expect(result).not.toContain('/rotate')
    expect(result).not.toContain(PLACEHOLDER_NOTICE)
  })

  test('GET /manage says there is no key when the only credential is a team client secret', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            ...sampleCredential,
            teamId: 'team-3',
            tier: 'team',
            allowedDeployments: ['gpt-4o']
          }
        ]
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('You do not have a key or client secret yet')
    expect(result).not.toContain('data-testid="keys-table-row"')
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
    expect(result).toContain('data-testid="models-unavailable"')
    expect(result).not.toContain('data-testid="models-placeholder"')
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
      expect.stringContaining('You do not have a key or client secret yet')
    )
  })

  test('GET /manage hides failed and pending credentials, including repeated failures for the same model, from the key list', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          { ...sampleCredential, _id: 'cred-failed-1', status: 'failed' },
          { ...sampleCredential, _id: 'cred-failed-2', status: 'failed' },
          { ...sampleCredential, _id: 'cred-pending-1', status: 'pending' }
        ]
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('You do not have a key or client secret yet')
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
    expect(result).toContain(
      'Teams share an OAuth client secret that lasts longer and can be rotated.'
    )
    expect(result).not.toContain('Team keys')
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
      expect.stringContaining('You do not have a key or client secret yet')
    )
    expect(result).toEqual(expect.stringContaining('ab12'))
    expect(result).toEqual(expect.stringContaining('Flood Risk Team'))
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

  test('GET /manage shows a status the frontend does not know as unknown, never as setting up', async () => {
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
            _id: 'deployment-u',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            status: 'brand-new-status'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('Status unknown')
    expect(result).not.toContain('Setting up')
    expect(result).not.toContain('brand-new-status')
    expect(result).not.toContain('Check progress')
    expect(result).not.toContain('Finish setting up')
    expect(result).not.toContain('http-equiv="refresh"')
  })

  test('GET /manage shows a queued team request as waiting for another change and keeps refreshing', async () => {
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
            _id: 'deployment-q',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            status: 'queued'
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
    expect(result).toContain('Waiting for another change')
    expect(result).toContain('govuk-tag--grey')
    expect(result).not.toContain('Setting up')
    expect(result).toContain('/connect/team/request/team-1/deployment-q')
    expect(result).toContain('http-equiv="refresh"')
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

  test('GET /manage lists a model being removed, keeps refreshing, and leaves a removed one out', async () => {
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
            _id: 'deployment-r1',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            status: 'removing'
          },
          {
            _id: 'deployment-r2',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            status: 'removed'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('Removing')
    expect(result).toContain('http-equiv="refresh" content="5"')
    expect(result).not.toContain('deployment-r2')
    expect(result).not.toContain('>Removed<')
  })

  test('GET /manage lists a model being removed with its own environment, and sends it to the team page', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          { _id: 'team-1', slug: 'flood-risk-team', name: 'Flood Risk Team' }
        ]
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'deployment-r1',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            environment: 'infradev',
            status: 'removing'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('Removing')
    // A removal is the team page's to follow; the request page would only send the person there.
    expect(result).toContain('href="/teams/flood-risk-team"')
    expect(result).not.toContain('/connect/team/request/team-1/deployment-r1')
    expect(result).toContain('Development')
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

    expect(result).toEqual(expect.stringContaining('Ready to use'))
    expect(result).not.toContain('Ready to view')
    expect(result).toContain('Finish setting up')
    expect(result).toEqual(
      expect.stringContaining('/connect/team/request/team-1/deployment-3')
    )
  })

  test('GET /manage sends a ready model to its team page once the team secret has been issued, even if since revoked', async () => {
    const cookies = await signIn(server)
    const revokedTeamCredential = {
      ...sampleCredential,
      _id: 'cred-team-revoked',
      teamId: 'team-1',
      tier: 'team',
      environment: 'infradev',
      status: 'revoked',
      allowedDeployments: ['gpt-4o']
    }

    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [revokedTeamCredential] })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'deployment-5',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            environment: 'infradev',
            status: 'active'
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
    expect(result).toContain('Ready to use')
    expect(result).toContain('Manage in Flood Risk Team')
    expect(result).not.toContain('Finish setting up')
    expect(result).not.toContain('/connect/team/request/team-1/deployment-5')
  })

  test('GET /manage lists every model with its team, environment and failure reason', async () => {
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
            _id: 'deployment-f',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            environment: 'infradev',
            status: 'deploy-failed',
            failureReason: 'The apply workflow failed'
          }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('data-testid="models-table"')
    expect(result).toContain('Your models')
    expect(result).not.toContain('Being set up')
    expect(result).toContain('Flood Risk Team')
    expect(result).toContain('Development')
    expect(result).toContain('Setup failed')
    expect(result).toContain('The apply workflow failed')
    expect(result).toContain('See what happened')
    expect(result).not.toContain('http-equiv="refresh"')
  })

  test('GET /manage says when none of the personâ€™s teams has a model', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('data-testid="models-placeholder"')
    expect(result).not.toContain('data-testid="models-table"')
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

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
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

  test.each([
    [
      'infradev',
      'Development',
      'https://apim-aip-infradev.azure-api.net/research/'
    ],
    ['sandbox', 'Sandbox', 'https://deploytestdefra.azure-api.net/research/'],
    [null, 'Sandbox', 'https://deploytestdefra.azure-api.net/research/']
  ])(
    'GET /manage/credentials/{id} for a research key issued in %s says so and shows that gateway',
    async (environment, expectedName, expectedHost) => {
      const cookies = await signIn(server)

      fetchMock.mockResponseOnce(
        JSON.stringify({ ...sampleCredential, environment })
      )
      fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

      const { result } = await server.inject({
        method: 'GET',
        url: '/manage/credentials/cred-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(result).toMatch(
        new RegExp(`Environment\\s*</dt>\\s*<dd[^>]*>\\s*${expectedName}`)
      )
      expect(result).toEqual(expect.stringContaining(expectedHost))
    }
  )

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

  test('GET /manage/credentials/{id} shows a "View full key" link for an active research credential', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('/manage/credentials/cred-1/view')
    )
    expect(result).toContain('View full key')
    expect(result).not.toContain('View full client secret')
  })

  test('GET /manage/credentials/{id}/view shows the reason form', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/view',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('Why do you need to see this?')
    )
    expect(result).toContain('View the full key for GPT-4o')
    expect(result).not.toContain('client secret')
  })

  test('POST /manage/credentials/{id}/view without a reason re-renders with an error', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/view',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, reason: '' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('POST /manage/credentials/{id}/view with a reason reveals the secret once', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify({ secret: 'full_mock_secret' }))

    const postReveal = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/view',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, reason: 'Debugging a failed call' }
    })

    expect(postReveal.statusCode).toBe(303)
    expect(postReveal.headers.location).toBe(
      '/manage/credentials/cred-1/revealed'
    )

    const redirectCookies = mergeCookies(cookies, postReveal)
    const getRevealed = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/revealed',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(getRevealed.statusCode).toBe(statusCodes.ok)
    expect(getRevealed.headers['cache-control']).toEqual(
      expect.stringContaining('no-store')
    )
    expect(getRevealed.result).toEqual(
      expect.stringContaining('full_mock_secret')
    )
    expect(getRevealed.result).toContain('Copy key')
    expect(getRevealed.result).not.toContain('client secret')

    const cookiesAfterRevealed = mergeCookies(redirectCookies, getRevealed)
    const getRevealedAgain = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/revealed',
      headers: { cookie: cookieHeader(cookiesAfterRevealed) }
    })

    expect(getRevealedAgain.statusCode).toBe(303)
    expect(getRevealedAgain.headers.location).toBe('/manage')
  })

  test('POST /manage/credentials/{id}/view shows a banner when the credential has been revoked', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleCredential, status: 'revoked' })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        code: 'credential-revoked',
        message: 'Credential has been revoked'
      }),
      { status: 409 }
    )

    const postReveal = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/view',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, reason: 'Debugging a failed call' }
    })

    expect(postReveal.statusCode).toBe(303)
    expect(postReveal.headers.location).toBe('/manage')

    const redirectCookies = mergeCookies(cookies, postReveal)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const getManage = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(getManage.result).toEqual(
      expect.stringContaining('This credential has been revoked.')
    )
  })

  describe('a team client secret is managed on the team’s page, not here', () => {
    const teamCredential = {
      ...sampleCredential,
      _id: 'cred-team',
      tier: 'team',
      teamId: 'team-1',
      allowedDeployments: ['gpt-4o']
    }

    function calledWithMethod(method) {
      return fetchMock.mock.calls.some(([, init]) => init?.method === method)
    }

    test('GET /manage/credentials/{id} is not found', async () => {
      const cookies = await signIn(server)

      fetchMock.mockResponseOnce(JSON.stringify(teamCredential))

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/manage/credentials/cred-team',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Credential not found')
    })

    test.each(['revoke', 'view'])(
      'GET /manage/credentials/{id}/%s goes back to the access page',
      async (step) => {
        const cookies = await signIn(server)

        fetchMock.mockResponseOnce(JSON.stringify(teamCredential))

        const { statusCode, headers } = await server.inject({
          method: 'GET',
          url: `/manage/credentials/cred-team/${step}`,
          headers: { cookie: cookieHeader(cookies) }
        })

        expect(statusCode).toBe(303)
        expect(headers.location).toBe('/manage')
      }
    )

    test('POST /manage/credentials/{id}/revoke does not revoke it', async () => {
      const cookies = await signIn(server)

      fetchMock.mockClear()
      fetchMock.mockResponseOnce(JSON.stringify(teamCredential))

      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url: '/manage/credentials/cred-team/revoke',
        headers: { cookie: cookieHeader(cookies) },
        payload: { crumb: cookies.crumb, confirmRevoke: 'yes' }
      })

      expect(statusCode).toBe(303)
      expect(headers.location).toBe('/manage')
      expect(calledWithMethod('DELETE')).toBe(false)
    })

    test('POST /manage/credentials/{id}/view does not reveal it', async () => {
      const cookies = await signIn(server)

      fetchMock.mockClear()
      fetchMock.mockResponseOnce(JSON.stringify(teamCredential))

      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url: '/manage/credentials/cred-team/view',
        headers: { cookie: cookieHeader(cookies) },
        payload: { crumb: cookies.crumb, reason: 'Debugging a failed call' }
      })

      expect(statusCode).toBe(303)
      expect(headers.location).toBe('/manage')
      expect(calledWithMethod('POST')).toBe(false)
    })

    test.each(['rotate', 'rotated'])(
      'GET /manage/credentials/{id}/%s is no longer a page',
      async (step) => {
        const cookies = await signIn(server)

        const { statusCode } = await server.inject({
          method: 'GET',
          url: `/manage/credentials/cred-team/${step}`,
          headers: { cookie: cookieHeader(cookies) }
        })

        expect(statusCode).toBe(statusCodes.notFound)
      }
    )
  })
})

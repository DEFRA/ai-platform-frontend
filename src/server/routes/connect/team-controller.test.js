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

const sampleTeam = { _id: 'team-1', name: 'Flood Risk Team' }

const sampleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai',
  description: 'Multimodal OpenAI model.',
  deploymentName: 'gpt-4o',
  apiVersion: '2024-05-01-preview',
  endpoint: 'https://mock-gateway.ai-platform.defra.gov.uk/openai/gpt-4o',
  limits: { requestsPerMinute: 60 }
}

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
}

async function reachCheckStep(server, cookies) {
  const postAccessType = await server.inject({
    method: 'POST',
    url: '/connect',
    headers: { cookie: cookieHeader(cookies) },
    payload: { crumb: cookies.crumb, accessType: 'team' }
  })
  cookies = mergeCookies(cookies, postAccessType)

  fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleTeam] }))
  const getSelectTeam = await server.inject({
    method: 'GET',
    url: '/connect/team/select',
    headers: { cookie: cookieHeader(cookies) }
  })
  cookies = mergeCookies(cookies, getSelectTeam)

  const postSelectTeam = await server.inject({
    method: 'POST',
    url: '/connect/team/select',
    headers: { cookie: cookieHeader(cookies) },
    payload: { crumb: cookies.crumb, teamId: 'team-1' }
  })
  cookies = mergeCookies(cookies, postSelectTeam)

  fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
  const getSelectModel = await server.inject({
    method: 'GET',
    url: '/connect/team/model',
    headers: { cookie: cookieHeader(cookies) }
  })
  cookies = mergeCookies(cookies, getSelectModel)

  const postSelectModel = await server.inject({
    method: 'POST',
    url: '/connect/team/model',
    headers: { cookie: cookieHeader(cookies) },
    payload: { crumb: cookies.crumb, modelSlug: 'gpt-4o' }
  })
  cookies = mergeCookies(cookies, postSelectModel)

  const postDetails = await server.inject({
    method: 'POST',
    url: '/connect/team/details',
    headers: { cookie: cookieHeader(cookies) },
    payload: { crumb: cookies.crumb, purpose: 'Journey test' }
  })
  cookies = mergeCookies(cookies, postDetails)

  return cookies
}

describe('#teamConnectController', () => {
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

  test('GET /connect/team/select redirects to /connect without a pending access type', async () => {
    const cookies = await signIn(server)

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/connect/team/select',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/connect')
  })

  test('GET /connect/team/select redirects to /teams/new when the user has no teams', async () => {
    let cookies = await signIn(server)

    const postAccessType = await server.inject({
      method: 'POST',
      url: '/connect',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, accessType: 'team' }
    })
    cookies = mergeCookies(cookies, postAccessType)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/connect/team/select',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(
      '/teams/new?returnTo=%2Fconnect%2Fteam%2Fselect'
    )
  })

  test('POST /connect/team/select with no team re-renders with an error', async () => {
    let cookies = await signIn(server)

    const postAccessType = await server.inject({
      method: 'POST',
      url: '/connect',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, accessType: 'team' }
    })
    cookies = mergeCookies(cookies, postAccessType)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleTeam] }))

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/connect/team/select',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('check step shows a summary and requests a deployment on confirm', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getCheck = await server.inject({
      method: 'GET',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCheck)
    expect(getCheck.result).toEqual(expect.stringContaining('GPT-4o'))

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-1', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postCheck.statusCode).toBe(statusCodes.seeOther)
    expect(postCheck.headers.location).toBe(
      '/connect/team/request/team-1/deployment-1'
    )
  })

  test('check step shows a link to the existing request on a 409', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 409,
        error: 'Conflict',
        message: 'A deployment already exists for this team and model',
        code: 'deployment-exists',
        existingId: 'deployment-1'
      }),
      { status: 409 }
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postCheck.statusCode).toBe(statusCodes.conflict)
    expect(postCheck.result).toEqual(
      expect.stringContaining('/connect/team/request/team-1/deployment-1')
    )
  })

  test('request wait page shows the "being set up" message while in progress, no JS required', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-2', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-2',
          status: 'deploying',
          modelSlug: 'gpt-4o',
          environment: 'sandbox',
          progressSteps: [
            { label: 'Request recorded', state: 'done' },
            { label: 'Team checked', state: 'done' },
            { label: 'Setting up access in Azure', state: 'current' },
            { label: 'Creating your key', state: 'pending' }
          ]
        }
      })
    )
    const getRequest = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-2',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getRequest.statusCode).toBe(statusCodes.ok)
    expect(getRequest.result).toEqual(expect.stringContaining('meta'))
    expect(getRequest.result).toEqual(expect.stringContaining('refresh'))
    expect(getRequest.result).toContain('Setting up your team client secret')
    expect(getRequest.result).not.toContain('team key')
    expect(getRequest.result).toEqual(
      expect.stringContaining('Setting up access in Azure')
    )
    expect(getRequest.result).not.toContain('Details for the AI Platform team')
  })

  test('request wait page shows a queued request as waiting for another change, keeps checking and issues nothing', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-7', status: 'queued' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-7',
          status: 'queued',
          modelSlug: 'gpt-4o',
          environment: 'sandbox',
          requestedBy: 'user-1',
          progressSteps: [
            { label: 'Request recorded', state: 'current' },
            { label: 'Team checked', state: 'pending' },
            { label: 'Setting up access in Azure', state: 'pending' },
            { label: 'Creating your client secret', state: 'pending' }
          ]
        }
      })
    )
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-7',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain(
      'Waiting for another change to this team to finish'
    )
    expect(result).toContain('Changes to a team are made one at a time.')
    expect(result).toContain('http-equiv="refresh"')
    expect(result).not.toContain('Setting up your team client secret')
    expect(result).not.toContain('This usually takes about 2 minutes')
    // Queued is not active, so the requester is never issued a credential.
    expect(
      fetchMock.mock.calls.some(([url]) => url.endsWith('/v1/credentials'))
    ).toBe(false)
  })

  test('request wait page links to the pull request and workflow runs the backend reports', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-5', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-5',
          status: 'pr-raised',
          progressSteps: [
            { label: 'Request recorded', state: 'done' },
            { label: 'Team checked', state: 'current' }
          ],
          links: {
            submitRun:
              'https://github.com/DEFRA/ai-platform-tenants/actions/runs/1001',
            pullRequest: 'https://github.com/DEFRA/ai-platform-tenants/pull/7',
            applyRun: 'javascript:alert(1)'
          }
        }
      })
    )
    const { result } = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-5',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('Details for the AI Platform team')
    expect(result).toContain(
      '<a class="govuk-link" href="https://github.com/DEFRA/ai-platform-tenants/pull/7">Pull request</a>'
    )
    expect(result).toContain(
      '<a class="govuk-link" href="https://github.com/DEFRA/ai-platform-tenants/actions/runs/1001">Submit workflow run</a>'
    )
    // Only https links are rendered, whatever the backend sends.
    expect(result).not.toContain('Apply workflow run')
    expect(result).not.toContain('javascript:alert')
  })

  test('request wait page issues an OAuth client secret once active and redirects to the credential page', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-3', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    const issuedCredential = {
      _id: 'cred-team-1',
      modelSlug: 'gpt-4o',
      teamId: 'team-1',
      tier: 'team',
      status: 'active',
      keyHint: 'tm01',
      expiresAt: null
    }
    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-3',
          status: 'active',
          modelSlug: 'gpt-4o',
          environment: 'sandbox',
          requestedBy: 'user-1'
        }
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        credential: issuedCredential,
        secret: 'mock_team_secret'
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const getRequest = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-3',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getRequest)

    expect(getRequest.statusCode).toBe(statusCodes.seeOther)
    expect(getRequest.headers.location).toBe('/connect/team/credential')

    const [, issueRequest] = fetchMock.mock.calls.find(
      ([url, options]) =>
        url.endsWith('/v1/credentials') && options.method === 'POST'
    )
    expect(JSON.parse(issueRequest.body)).toEqual({
      modelSlug: 'gpt-4o',
      tier: 'team',
      teamId: 'team-1',
      environment: 'sandbox',
      credentialType: 'oauth'
    })

    const getCredential = await server.inject({
      method: 'GET',
      url: '/connect/team/credential',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getCredential.statusCode).toBe(statusCodes.ok)
    expect(getCredential.result).toEqual(
      expect.stringContaining('mock_team_secret')
    )
    expect(getCredential.result).toContain('Your client secret is ready')
    expect(getCredential.result).toContain('Copy client secret')
    expect(getCredential.result).toContain(
      'See this client secret and your other access'
    )
    expect(getCredential.result).not.toContain('Your key')
    expect(getCredential.result).not.toContain('Ocp-Apim-Subscription-Key')
    expect(getCredential.result).toEqual(
      expect.stringContaining('Does not expire')
    )
    expect(getCredential.headers['cache-control']).toEqual(
      expect.stringContaining('no-store')
    )
  })

  test('request wait page says team client secrets are not available yet when no gateway issues them (501 gateway-not-enabled)', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-8', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-8',
          status: 'active',
          modelSlug: 'gpt-4o',
          environment: 'sandbox',
          requestedBy: 'user-1'
        }
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: statusCodes.notImplemented,
        error: 'Not Implemented',
        message: 'No gateway issues team OAuth credentials yet',
        code: 'gateway-not-enabled'
      }),
      { status: statusCodes.notImplemented }
    )

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-8',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.notImplemented)
    expect(result).toContain('We cannot create your team client secret yet')
    expect(result).toContain(
      'Team client secrets are not available in this environment yet.'
    )
    expect(result).toContain('Go to your access')
    expect(result).not.toContain('No gateway issues team OAuth credentials yet')
    expect(result).not.toContain('Something went wrong')
  })

  test('request wait page leaves any other issuing error to the generic error page', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-9', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-9',
          status: 'active',
          modelSlug: 'gpt-4o',
          environment: 'sandbox',
          requestedBy: 'user-1'
        }
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        message: 'The issuer did not answer',
        code: 'upstream-unavailable'
      }),
      { status: 502 }
    )

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-9',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.internalServerError)
    expect(result).toContain('Something went wrong')
    expect(result).not.toContain(
      'Team client secrets are not available in this environment yet.'
    )
  })

  test('request wait page redirects to /manage with a banner when the credential was already revealed to someone else', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-3b', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-3b',
          status: 'active',
          modelSlug: 'gpt-4o',
          environment: 'sandbox',
          requestedBy: 'user-1'
        }
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        credential: {
          _id: 'cred-team-2',
          modelSlug: 'gpt-4o',
          teamId: 'team-1',
          status: 'active'
        }
      })
    )

    const getRequest = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-3b',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getRequest.statusCode).toBe(statusCodes.seeOther)
    expect(getRequest.headers.location).toBe('/manage')
  })

  test('request wait page redirects to /manage instead of re-issuing a credential once revoked', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-3d', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-3d',
          status: 'active',
          modelSlug: 'gpt-4o',
          environment: 'sandbox',
          requestedBy: 'user-1'
        }
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'cred-team-revoked',
            modelSlug: 'gpt-4o',
            teamId: 'team-1',
            tier: 'team',
            status: 'revoked',
            allowedDeployments: ['gpt-4o']
          }
        ]
      })
    )

    const getRequest = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-3d',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getRequest.statusCode).toBe(statusCodes.seeOther)
    expect(getRequest.headers.location).toBe('/manage')
    // No credential POST is made at all - a revoked team credential must
    // never be silently re-issued via this link.
    expect(fetchMock.mock.calls.at(-1)[0]).toEqual(
      expect.stringContaining('/v1/credentials')
    )
    expect(fetchMock.mock.calls.at(-1)[1].method).toBe('GET')
  })

  test('request wait page never reveals the secret to a teammate who did not request the deployment', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-3c', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-3c',
          status: 'active',
          modelSlug: 'gpt-4o',
          environment: 'sandbox',
          requestedBy: 'a-different-teammate'
        }
      })
    )

    const getRequest = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-3c',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getRequest.statusCode).toBe(statusCodes.seeOther)
    expect(getRequest.headers.location).toBe('/manage')
    // No credential POST is made at all, so no secret can be minted for them.
    expect(fetchMock.mock.calls.at(-1)[0]).toEqual(
      expect.stringContaining('/v1/teams/team-1/deployments/deployment-3c')
    )
  })

  test('request wait page shows a not found page for an unknown deployment', async () => {
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
      url: '/connect/team/request/team-1/unknown-deployment',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Request not found'))
  })

  test('request wait page shows a safe error for a failed deployment', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-4', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-4',
          status: 'checks-failed',
          failureReason: 'Automated checks failed (mock)'
        }
      })
    )
    const getRequest = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-4',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getRequest.statusCode).toBe(statusCodes.ok)
    expect(getRequest.result).toEqual(
      expect.stringContaining('Something went wrong')
    )
    expect(getRequest.result).toContain('Automated checks failed (mock)')
  })

  test('request wait page shows the failure reason and the failed apply run for support', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: { _id: 'deployment-6', status: 'requested' }
      })
    )
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/team/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        deployment: {
          _id: 'deployment-6',
          status: 'deploy-failed',
          failureReason:
            'The apply failed again after a fresh retry, so the change is being reverted',
          links: {
            pullRequest: 'https://github.com/DEFRA/ai-platform-tenants/pull/7',
            applyRun:
              'https://github.com/DEFRA/ai-platform-tenants/actions/runs/2002'
          }
        }
      })
    )
    const { result } = await server.inject({
      method: 'GET',
      url: '/connect/team/request/team-1/deployment-6',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain('Something went wrong')
    expect(result).toContain('the change is being reverted')
    expect(result).toContain(
      '<a class="govuk-link" href="https://github.com/DEFRA/ai-platform-tenants/actions/runs/2002">Apply workflow run</a>'
    )
    expect(result).not.toContain('Submit workflow run')
  })
})

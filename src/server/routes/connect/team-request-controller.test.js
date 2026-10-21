import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  mergeCookies
} from '#/test-helpers/oidc-session-helpers.js'
import {
  nanoModel,
  sampleModel,
  teamConnectHelpers
} from '#/test-helpers/team-connect-helpers.js'

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

const { mockResponse, get, makeRequest } = teamConnectHelpers(fetchMock)

const STAGES = [
  { label: 'Request recorded', state: 'done' },
  { label: 'Team checked', state: 'done' },
  { label: 'Setting up access in Azure', state: 'current' },
  { label: 'Preparing your client secret', state: 'pending' }
]

// A deployment as the backend lists it, active and requested by the signed-in
// person unless overridden.
function deployment(overrides = {}) {
  return {
    _id: 'deployment-1',
    status: 'active',
    modelSlug: 'gpt-4o',
    environment: 'sandbox',
    requestedBy: 'user-1',
    ...overrides
  }
}

function mockDeployments(...deployments) {
  mockResponse({ items: deployments })
}

function credentialPosts() {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) => url.endsWith('/v1/credentials') && init.method === 'POST'
    )
    .map(([, init]) => JSON.parse(init.body))
}

const PLACEHOLDER_NOTICE = 'data-testid="placeholder-credential-notice"'

const issued = (
  secret,
  allowedDeployments = ['gpt-4o'],
  issuerKey = 'mock'
) => ({
  credential: {
    _id: 'cred-team-1',
    teamId: 'team-1',
    tier: 'team',
    status: 'active',
    issuerKey,
    keyHint: 'tm01',
    allowedDeployments,
    expiresAt: null
  },
  ...(secret ? { secret } : {})
})

describe('#teamRequestController', () => {
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
    cookies = await signInViaOidc(server, fetchMock)
  })

  function request(id = 'deployment-1', teamId = 'team-1') {
    return get(server, cookies, `/connect/team/request/${teamId}/${id}`)
  }

  describe('for one model', () => {
    test('shows the "being set up" message while in progress, no JS required', async () => {
      mockDeployments(
        deployment({ status: 'deploying', progressSteps: STAGES })
      )

      const { statusCode, result } = await request()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('http-equiv="refresh"')
      expect(result).toContain('Setting up your model access')
      expect(result).not.toContain('Setting up your team client secret')
      expect(result).toContain('This usually takes about 2 minutes. You can')
      expect(result).toContain('Setting up access in Azure')
      expect(result).not.toContain('team key')
      expect(result).not.toContain('Details for the AI Platform team')
      expect(result).not.toContain('<h3')
    })

    test('promises the client secret once the request is on that step', async () => {
      mockDeployments(deployment({ status: 'verified', progressSteps: STAGES }))

      const { result } = await request()

      expect(result).toContain('Setting up your team client secret')
      expect(result).not.toContain('Setting up your model access')
    })

    test('says the client secret will be a placeholder while the backend mocks it', async () => {
      mockDeployments(
        deployment({
          status: 'deploying',
          progressSteps: STAGES,
          credentialPlaceholder: true
        })
      )

      const { result } = await request()

      expect(result).toContain(PLACEHOLDER_NOTICE)
    })

    test('does not mention a placeholder once the backend issues real client secrets', async () => {
      mockDeployments(
        deployment({
          status: 'deploying',
          progressSteps: STAGES,
          credentialPlaceholder: false
        })
      )

      const { result } = await request()

      expect(result).not.toContain(PLACEHOLDER_NOTICE)
    })

    test('shows a queued request as waiting for another change, keeps checking and issues nothing', async () => {
      mockDeployments(deployment({ status: 'queued', progressSteps: STAGES }))

      const { statusCode, result } = await request()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(
        'Waiting for another change to this team to finish'
      )
      expect(result).toContain('Changes to a team are made one at a time.')
      expect(result).toContain('http-equiv="refresh"')
      expect(result).not.toContain('Setting up your team client secret')
      expect(result).not.toContain('This usually takes about 2 minutes')
      expect(credentialPosts()).toEqual([])
    })

    test('links to the pull request and workflow runs the backend reports, https only', async () => {
      mockDeployments(
        deployment({
          status: 'pr-raised',
          progressSteps: STAGES,
          links: {
            submitRun:
              'https://github.com/DEFRA/ai-platform-tenants/actions/runs/1001',
            pullRequest: 'https://github.com/DEFRA/ai-platform-tenants/pull/7',
            applyRun: 'javascript:alert(1)'
          }
        })
      )

      const { result } = await request()

      expect(result).toContain('Details for the AI Platform team')
      expect(result).toContain(
        '<a class="govuk-link" href="https://github.com/DEFRA/ai-platform-tenants/pull/7">Pull request</a>'
      )
      expect(result).toContain(
        '<a class="govuk-link" href="https://github.com/DEFRA/ai-platform-tenants/actions/runs/1001">Submit workflow run</a>'
      )
      expect(result).not.toContain('Apply workflow run')
      expect(result).not.toContain('javascript:alert')
    })

    test('issues an OAuth client secret once active and shows it once on the credential page', async () => {
      mockDeployments(deployment())
      mockResponse({ items: [] })
      mockResponse(issued('mock_team_secret'))
      mockResponse(sampleModel)

      const getRequest = await request()
      cookies = mergeCookies(cookies, getRequest)

      expect(getRequest.statusCode).toBe(statusCodes.seeOther)
      expect(getRequest.headers.location).toBe('/connect/team/credential')
      expect(credentialPosts()).toEqual([
        {
          modelSlug: 'gpt-4o',
          tier: 'team',
          teamId: 'team-1',
          environment: 'sandbox',
          credentialType: 'oauth'
        }
      ])

      const getCredential = await get(
        server,
        cookies,
        '/connect/team/credential'
      )

      expect(getCredential.statusCode).toBe(statusCodes.ok)
      expect(getCredential.result).toContain('mock_team_secret')
      expect(getCredential.result).toContain('Your client secret is ready')
      expect(getCredential.result).toContain('Copy client secret')
      expect(getCredential.result).toContain(
        'See this client secret and your other access'
      )
      expect(getCredential.result).toContain('Does not expire')
      expect(getCredential.result).not.toContain('Your key')
      expect(getCredential.result).not.toContain('Ocp-Apim-Subscription-Key')
      expect(getCredential.result).not.toContain('Your models')
      expect(getCredential.headers['cache-control']).toContain('no-store')
      // A mocked team secret never appears without saying it is a placeholder.
      expect(getCredential.result).toContain(PLACEHOLDER_NOTICE)

      const again = await get(server, cookies, '/connect/team/credential')

      expect(again.headers.location).toBe('/models')
    })

    test('shows no placeholder notice for a client secret a real issuer made', async () => {
      mockDeployments(deployment())
      mockResponse({ items: [] })
      mockResponse(issued('real_team_secret', ['gpt-4o'], 'azure-apim'))
      mockResponse(sampleModel)

      const getRequest = await request()
      cookies = mergeCookies(cookies, getRequest)

      const { result } = await get(server, cookies, '/connect/team/credential')

      expect(result).toContain('real_team_secret')
      expect(result).not.toContain(PLACEHOLDER_NOTICE)
    })

    test('says team client secrets are not available yet when no gateway issues them (501 gateway-not-enabled)', async () => {
      mockDeployments(deployment())
      mockResponse({ items: [] })
      mockResponse(
        {
          statusCode: statusCodes.notImplemented,
          error: 'Not Implemented',
          message: 'No gateway issues team OAuth credentials yet',
          code: 'gateway-not-enabled'
        },
        { status: statusCodes.notImplemented }
      )

      const { statusCode, result } = await request()

      expect(statusCode).toBe(statusCodes.notImplemented)
      expect(result).toContain('We cannot create your team client secret yet')
      expect(result).toContain(
        'Team client secrets are not available in this environment yet.'
      )
      expect(result).toContain('Go to your access')
      expect(result).not.toContain('No gateway issues team OAuth')
      expect(result).not.toContain('Something went wrong')
    })

    test('leaves any other issuing error to the generic error page', async () => {
      mockDeployments(deployment())
      mockResponse({ items: [] })
      mockResponse(
        { message: 'The issuer did not answer', code: 'upstream-unavailable' },
        { status: 502 }
      )

      const { statusCode, result } = await request()

      expect(statusCode).toBe(statusCodes.internalServerError)
      expect(result).toContain('Something went wrong')
    })

    test('goes to /manage when the secret was already revealed to someone else', async () => {
      mockDeployments(deployment())
      mockResponse({ items: [] })
      mockResponse(issued())

      const { statusCode, headers } = await request()

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/manage')
    })

    test('goes to /manage instead of re-issuing a secret once revoked', async () => {
      mockDeployments(deployment())
      mockResponse({
        items: [
          {
            _id: 'cred-team-revoked',
            teamId: 'team-1',
            tier: 'team',
            status: 'revoked',
            allowedDeployments: ['gpt-4o']
          }
        ]
      })

      const { statusCode, headers } = await request()

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/manage')
      expect(credentialPosts()).toEqual([])
    })

    test('never reveals the secret to a teammate who did not request it', async () => {
      mockDeployments(deployment({ requestedBy: 'a-different-teammate' }))

      const { statusCode, headers } = await request()

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/manage')
      expect(credentialPosts()).toEqual([])
    })

    test('shows a not found page when the team is not the person’s to see', async () => {
      mockResponse(
        { statusCode: 404, error: 'Not Found', message: 'Not Found' },
        { status: 404 }
      )

      const { statusCode, result } = await request('unknown-deployment')

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Request not found')
    })

    test('shows a not found page for a deployment the team does not have', async () => {
      mockDeployments(deployment({ _id: 'another-deployment' }))

      const { statusCode, result } = await request('unknown-deployment')

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Request not found')
    })

    test.each(['removing', 'removed'])(
      'sends a %s deployment to its team page, where the removal is shown',
      async (status) => {
        mockDeployments(deployment({ status }))

        const { statusCode, headers } = await request()

        expect(statusCode).toBe(statusCodes.seeOther)
        expect(headers.location).toBe('/teams/team-1')
      }
    )

    test('shows a safe error for a failed deployment', async () => {
      mockDeployments(
        deployment({
          status: 'checks-failed',
          failureReason: 'Automated checks failed (mock)'
        })
      )

      const { statusCode, result } = await request()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Something went wrong')
      expect(result).toContain('Automated checks failed (mock)')
    })

    test('says verification failed, and what to do, when Azure resources could not be confirmed', async () => {
      mockDeployments(
        deployment({
          status: 'deploy-failed',
          failureReason:
            "Your team's resources were created but could not be confirmed: this environment is not set up in the portal (environment-not-configured). Ask the AI Platform team to check and retry.",
          verificationFailure: {
            reason: 'environment-not-configured',
            attempts: 5
          }
        })
      )

      const { result } = await request()

      expect(result).toContain('data-testid="verification-failed"')
      expect(result).toContain('Ask the AI Platform team to check and retry')
      expect(result).toContain('environment-not-configured')
    })

    test('does not mention verification for a failure that is not one', async () => {
      mockDeployments(
        deployment({ status: 'deploy-failed', failureReason: 'Apply failed' })
      )

      const { result } = await request()

      expect(result).not.toContain('data-testid="verification-failed"')
    })

    test('shows the failure reason and the failed apply run for support', async () => {
      mockDeployments(
        deployment({
          status: 'deploy-failed',
          failureReason:
            'The apply failed again after a fresh retry, so the change is being reverted',
          links: {
            pullRequest: 'https://github.com/DEFRA/ai-platform-tenants/pull/7',
            applyRun:
              'https://github.com/DEFRA/ai-platform-tenants/actions/runs/2002'
          }
        })
      )

      const { result } = await request()

      expect(result).toContain('Details for the AI Platform team')
      expect(result).toContain('so the change is being reverted')
      expect(result).toContain('Apply workflow run')
    })
  })

  describe('for several models', () => {
    const MODELS = ['gpt-4o', 'gpt-4-1-nano']
    const MADE = [
      { _id: 'deployment-1', status: 'requested' },
      { _id: 'deployment-2', status: 'queued' }
    ]
    const first = (overrides) => deployment(overrides)
    const second = (overrides) =>
      deployment({
        _id: 'deployment-2',
        modelSlug: 'gpt-4-1-nano',
        ...overrides
      })

    // The request just made, so the session remembers both deployments.
    async function afterRequest() {
      cookies = await makeRequest(server, cookies, MODELS, MADE)
      fetchMock.mockClear()
    }

    function mockNames() {
      mockResponse({ items: [sampleModel, nanoModel] })
    }

    test('shows each model’s progress, named, while any is still being set up', async () => {
      await afterRequest()
      mockDeployments(
        first({ status: 'deploying', progressSteps: STAGES }),
        second({ status: 'queued', progressSteps: STAGES })
      )
      mockNames()

      const { statusCode, result } = await request()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('<h3 class="govuk-heading-s">GPT-4o</h3>')
      expect(result).toContain('<h3 class="govuk-heading-s">GPT-4.1 nano</h3>')
      expect(result).toContain('Setting up your model access')
      expect(result).toContain('about 2 minutes for each model')
      expect(result).toContain('http-equiv="refresh"')
      expect(credentialPosts()).toEqual([])
    })

    test('says it is waiting only when every model is', async () => {
      await afterRequest()
      mockDeployments(first({ status: 'queued' }), second({ status: 'queued' }))
      mockNames()

      const { result } = await request()

      expect(result).toContain(
        'Waiting for another change to this team to finish'
      )
    })

    test('issues one client secret for every model once all are active', async () => {
      await afterRequest()
      mockDeployments(first(), second())
      mockNames()
      mockResponse({ items: [] })
      mockResponse(issued('mock_team_secret'))
      mockResponse(issued(undefined, ['gpt-4o', 'gpt-4-1-nano']))
      mockResponse(sampleModel)
      mockResponse(nanoModel)

      const getRequest = await request()
      cookies = mergeCookies(cookies, getRequest)

      expect(getRequest.headers.location).toBe('/connect/team/credential')
      expect(credentialPosts().map(({ modelSlug }) => modelSlug)).toEqual(
        MODELS
      )

      const { result } = await get(server, cookies, '/connect/team/credential')

      expect(result).toContain('mock_team_secret')
      expect(result).toContain('GPT-4o, GPT-4.1 nano')
      expect(result).toContain('Your models')
      expect(result).toContain('gpt-4-1-nano')
      expect(result).not.toContain('Not added to your client secret')
    })

    test('still shows the secret, and says so, when a later model cannot be added to it', async () => {
      await afterRequest()
      mockDeployments(first(), second())
      mockNames()
      mockResponse({ items: [] })
      mockResponse(issued('mock_team_secret'))
      mockResponse(
        { message: 'The issuer did not answer', code: 'upstream-unavailable' },
        { status: 502 }
      )
      mockResponse(sampleModel)
      mockResponse(nanoModel)

      const getRequest = await request()
      cookies = mergeCookies(cookies, getRequest)

      expect(getRequest.headers.location).toBe('/connect/team/credential')

      const { result } = await get(server, cookies, '/connect/team/credential')

      expect(result).toContain('mock_team_secret')
      expect(result).toContain('Not added to your client secret: GPT-4.1 nano')
    })

    test('issues for the models that were set up, and names the one that failed', async () => {
      await afterRequest()
      mockDeployments(first(), second({ status: 'deploy-failed' }))
      mockNames()
      mockResponse({ items: [] })
      mockResponse(issued('mock_team_secret'))
      mockResponse(sampleModel)
      mockResponse(nanoModel)

      const getRequest = await request()
      cookies = mergeCookies(cookies, getRequest)

      expect(credentialPosts().map(({ modelSlug }) => modelSlug)).toEqual([
        'gpt-4o'
      ])

      const { result } = await get(server, cookies, '/connect/team/credential')

      expect(result).toContain('Not added to your client secret: GPT-4.1 nano')
      expect(result).not.toContain('Your models')
    })

    test('lists every model that failed when none could be set up', async () => {
      await afterRequest()
      mockDeployments(
        first({ status: 'checks-failed', failureReason: 'Checks failed' }),
        second({ status: 'deploy-failed', failureReason: 'Apply failed' })
      )
      mockNames()

      const { statusCode, result } = await request()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Something went wrong')
      expect(result).toContain('<li>GPT-4o</li>')
      expect(result).toContain('<li>GPT-4.1 nano</li>')
      expect(result).toContain('Checks failed')
      expect(result).toContain('Apply failed')
      expect(credentialPosts()).toEqual([])
    })

    test('follows only the model in its address once the session has forgotten the request', async () => {
      mockDeployments(first({ status: 'deploying' }), second())

      const { result } = await request()

      expect(result).not.toContain('<h3')
      expect(fetchMock.mock.calls.map(([url]) => url)).not.toContainEqual(
        expect.stringContaining('/v1/models')
      )
    })

    test('leaves a model that is being removed to the team page', async () => {
      await afterRequest()
      mockDeployments(
        first({ status: 'deploying' }),
        second({ status: 'removed' })
      )

      const { result } = await request()

      expect(result).not.toContain('<h3')
      expect(result).toContain('Setting up your model access')
    })
  })
})

import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { signInViaOidc } from '#/test-helpers/oidc-session-helpers.js'
import {
  abroadModel,
  nanoModel,
  sampleModel,
  teamConnectHelpers,
  teamWithMembers
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

const NOT_FOUND = { statusCode: 404, error: 'Not Found', message: 'Not Found' }

const STEPS = [
  { label: 'Request recorded', state: 'done', at: '2026-10-21T10:41:00.000Z' },
  { label: 'Team checked', state: 'done', at: '2026-10-21T10:42:00.000Z' },
  {
    label: 'Setting up GPT-4o in Azure',
    state: 'current',
    at: '2026-10-21T10:42:30.000Z'
  },
  { label: 'Preparing your client secret', state: 'pending', at: null }
]

// A deployment as the backend lists it, active in the first environment
// unless overridden.
function deployment(overrides = {}) {
  return {
    _id: 'deployment-1',
    teamId: 'team-1',
    status: 'active',
    modelSlug: 'gpt-4o',
    environment: 'infradev',
    requestedBy: 'user-1',
    operationId: 'op-1234567-7f3k2',
    ...overrides
  }
}

const teamCredential = {
  _id: 'cred-1',
  tier: 'team',
  teamId: 'team-1',
  environment: 'infradev',
  status: 'active'
}

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

  // What the page reads, in order: the team (and so the person's role in it),
  // the team's deployments, the catalogue for names and, to an admin of a
  // team whose models are ready, the credentials.
  function mockPage({
    role = 'admin',
    deployments,
    catalogue = [sampleModel, nanoModel, abroadModel],
    credentials
  }) {
    mockResponse(teamWithMembers(role))
    mockResponse({ items: deployments })

    if (catalogue) {
      mockResponse({ items: catalogue })
    }

    if (credentials) {
      mockResponse({ items: credentials })
    }
  }

  function page(id = 'deployment-1', team = 'flood-risk-team') {
    return get(server, cookies, `/connect/team/request/${team}/${id}`)
  }

  function calledWith(text) {
    return fetchMock.mock.calls.some(([url]) => url.includes(text))
  }

  describe('while a model is being set up', () => {
    test('says what is being set up, how long it takes, and shows each step with its time', async () => {
      mockPage({
        deployments: [deployment({ status: 'deploying', progressSteps: STEPS })]
      })

      const { statusCode, result } = await page()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Setting up GPT-4o for your team')
      expect(result).toContain('Flood Risk Team')
      expect(result).toContain(
        'This usually takes about 2 minutes. You can leave this page and come back.'
      )
      expect(result).toContain('Request recorded')
      expect(result).toContain('10:41')
      expect(result).toContain('Started at 10:42')
      expect(result).toContain('Preparing your client secret')
      expect(result).toContain('Done: ')
      expect(result).toContain('In progress: ')
      expect(result).toContain('Not started: ')
      expect(result).toContain('This page updates by itself. Last checked at')
      expect(result).toContain('http-equiv="refresh"')
    })

    test('has a link to the team and none of the old controls, banner or pipeline links', async () => {
      mockPage({
        deployments: [
          deployment({
            status: 'pr-raised',
            progressSteps: STEPS,
            links: { pullRequest: 'https://github.com/DEFRA/tenants/pull/7' }
          })
        ]
      })

      const { result } = await page()

      expect(result).toContain(
        'href="/teams/flood-risk-team">Go to Flood Risk Team</a>'
      )
      expect(result).not.toContain('Stop checking')
      expect(result).not.toContain('Check now')
      expect(result).not.toContain('govuk-notification-banner')
      expect(result).not.toContain('Details for the AI Platform team')
      expect(result).not.toContain('github.com')
      expect(result).not.toContain('placeholder-credential-notice')
    })

    test('shows a queued request as waiting for another change to the team', async () => {
      mockPage({
        deployments: [deployment({ status: 'queued', progressSteps: STEPS })]
      })

      const { statusCode, result } = await page()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(
        'Waiting for another change to Flood Risk Team to finish'
      )
      expect(result).toContain('http-equiv="refresh"')
      expect(result).not.toContain('Setting up GPT-4o for your team')
    })

    test('keeps waiting for a state it does not know', async () => {
      mockPage({ deployments: [deployment({ status: 'something-new' })] })

      const { result } = await page()

      expect(result).toContain('Setting up GPT-4o for your team')
    })

    test('shows no times for a step that has none', async () => {
      mockPage({
        deployments: [
          deployment({
            status: 'requested',
            progressSteps: [
              { label: 'Request recorded', state: 'current', at: null }
            ]
          })
        ]
      })

      const { result } = await page()

      expect(result).toContain('Request recorded')
      expect(result).not.toContain('Started at')
    })

    test('names a model by its slug when the catalogue no longer lists it', async () => {
      mockPage({
        catalogue: [],
        deployments: [deployment({ status: 'deploying' })]
      })

      const { result } = await page()

      expect(result).toContain('Setting up gpt-4o for your team')
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

    test('names every model in the heading and gives each its own steps', async () => {
      await afterRequest()
      mockPage({
        deployments: [
          first({ status: 'deploying', progressSteps: STEPS }),
          second({ status: 'queued', progressSteps: STEPS })
        ]
      })

      const { statusCode, result } = await page()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(
        'Setting up GPT-4o and GPT-4.1 nano for your team'
      )
      expect(result).toContain('<h2 class="govuk-heading-m">GPT-4o</h2>')
      expect(result).toContain('<h2 class="govuk-heading-m">GPT-4.1 nano</h2>')
      expect(result).toContain('about 2 minutes for each model')
    })

    test('follows the whole request from a link that names the team by its id', async () => {
      await afterRequest()
      mockPage({
        deployments: [
          first({ status: 'active', progressSteps: STEPS }),
          second({ status: 'deploying', progressSteps: STEPS })
        ]
      })

      const { result } = await page('deployment-1', 'team-1')

      expect(result).toContain(
        'Setting up GPT-4o and GPT-4.1 nano for your team'
      )
      expect(result).toContain('http-equiv="refresh"')
    })

    test('keeps waiting while any model is still being set up', async () => {
      await afterRequest()
      mockPage({
        deployments: [
          first({ status: 'active', progressSteps: STEPS }),
          second({ status: 'deploying', progressSteps: STEPS })
        ]
      })

      const { result } = await page()

      expect(result).toContain('http-equiv="refresh"')
    })

    test('follows only the deployment in the address once the session no longer remembers the request', async () => {
      mockPage({
        deployments: [
          first({ status: 'deploying', progressSteps: STEPS }),
          second({ status: 'queued', progressSteps: STEPS })
        ]
      })

      const { result } = await page()

      expect(result).toContain('Setting up GPT-4o for your team')
      expect(result).not.toContain('GPT-4.1 nano')
    })

    test('says every model is ready, in one panel', async () => {
      await afterRequest()
      mockPage({
        deployments: [first(), second()],
        credentials: [teamCredential]
      })

      const { result } = await page()

      expect(result).toContain('GPT-4o and GPT-4.1 nano are ready')
      expect(result).toContain(
        'everyone in Flood Risk Team can use GPT-4o and GPT-4.1 nano with it'
      )
    })

    test('says what failed, and that the model that worked is not affected', async () => {
      await afterRequest()
      mockPage({
        deployments: [
          first(),
          second({ modelSlug: 'gpt-5-mini', status: 'deploy-failed' })
        ]
      })

      const { result } = await page()

      expect(result).toContain('We could not set up GPT-5 mini')
      expect(result).toContain('GPT-4o is not affected.')
      expect(result).toContain('use GPT-4o, which your team already has')
    })

    test('names every model that failed, with a reference and technical details for each', async () => {
      await afterRequest()
      mockPage({
        deployments: [
          first({
            status: 'checks-failed',
            operationId: 'op-aaaaaaa-11111',
            failureReason: 'First failed'
          }),
          second({
            status: 'deploy-failed',
            operationId: 'op-bbbbbbb-22222',
            failureReason: 'Second failed'
          })
        ]
      })

      const { result } = await page()

      expect(result).toContain('We could not set up GPT-4o and GPT-4.1 nano')
      expect(result).toContain('AIP-11111, AIP-22222')
      expect(result).toContain('remove GPT-4o from your team')
      expect(result).toContain('remove GPT-4.1 nano from your team')
      expect(result).toContain('<h3 class="govuk-heading-s">GPT-4o</h3>')
      expect(result).toContain('First failed')
      expect(result).toContain('Second failed')
      expect(result).not.toContain('not affected')
      expect(result).not.toContain('which your team already has')
    })

    test('tells a member to ask an admin to remove them all', async () => {
      await afterRequest()
      mockPage({
        role: 'user',
        deployments: [
          first({ status: 'checks-failed' }),
          second({ status: 'deploy-failed' })
        ]
      })

      const { result } = await page()

      expect(result).toContain(
        'ask an admin of Flood Risk Team to remove them from your team'
      )
    })
  })

  describe('when a model is ready', () => {
    const configured = config.get('teamEnvironments')

    afterEach(() => {
      config.set('teamEnvironments', configured)
    })

    test('an admin gets a panel, the way to show the client secret, and what happens next', async () => {
      mockPage({
        deployments: [deployment()],
        credentials: [
          { ...teamCredential, _id: 'cred-other', environment: 'qa' },
          { ...teamCredential, _id: 'cred-revoked', status: 'revoked' },
          teamCredential
        ]
      })

      const { statusCode, result } = await page()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('GPT-4o is ready')
      expect(result).toContain('for Flood Risk Team, in Development')
      expect(result).toContain('Get your client secret')
      expect(result).toContain(
        'Your team shares one client secret for Development. Have somewhere safe ready to paste it'
      )
      expect(result).toContain('Show the client secret')
      expect(result).toContain('href="/manage/credentials/cred-1/view"')
      expect(result).toContain('What happens next')
      expect(result).toContain(
        'everyone in Flood Risk Team can use GPT-4o with it'
      )
      expect(result).toContain(
        'admins can show it again or rotate it from <a class="govuk-link" href="/teams/flood-risk-team">your team'
      )
      expect(result).not.toContain('Ask an admin')
      expect(result).not.toContain('http-equiv="refresh"')
    })

    test('never shows a client secret, which only a reveal with a reason can', async () => {
      mockPage({
        deployments: [deployment()],
        credentials: [{ ...teamCredential, secret: 'must-not-appear' }]
      })

      const { result } = await page()

      expect(result).not.toContain('must-not-appear')
      expect(calledWith('/reveal')).toBe(false)
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url.includes('/v1/credentials') && init.method === 'POST'
        )
      ).toBe(false)
    })

    test('says the client secret is not ready when the team has none yet', async () => {
      mockPage({ deployments: [deployment()], credentials: [] })

      const { result } = await page()

      expect(result).toContain('The client secret is not ready yet.')
      expect(result).not.toContain('Show the client secret')
    })

    test('says the client secret was revoked, not that it is coming, when the only one for the environment is revoked', async () => {
      mockPage({
        deployments: [deployment()],
        credentials: [{ ...teamCredential, status: 'revoked' }]
      })

      const { result } = await page()

      expect(result).toContain('data-testid="secret-revoked"')
      expect(result).toContain(
        'The client secret for Development was revoked, so there is nothing to show.'
      )
      expect(result).toContain('href="/manage"')
      expect(result).not.toContain('not ready yet')
      expect(result).not.toContain('Show the client secret')
    })

    test('a member is told to ask an admin, and is not offered the reveal', async () => {
      mockPage({ role: 'user', deployments: [deployment()] })

      const { statusCode, result } = await page()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('GPT-4o is ready')
      expect(result).toContain(
        'Ask an admin of Flood Risk Team for the client secret.'
      )
      expect(result).not.toContain('Show the client secret')
      expect(calledWith('/v1/credentials')).toBe(false)
    })

    test('points to setting it up in Test once Test is available', async () => {
      config.set('teamEnvironments', ['infradev', 'qa'])
      mockPage({
        deployments: [deployment()],
        credentials: [teamCredential]
      })

      const { result } = await page()

      expect(result).toContain(
        'when it is working, you can <a class="govuk-link" href="/teams/flood-risk-team/test">set it up in Test</a>'
      )
    })

    test('does not point to Test while Test is not available', async () => {
      mockPage({ deployments: [deployment()], credentials: [teamCredential] })

      const { result } = await page()

      expect(result).not.toContain('set it up in Test')
      expect(result).not.toContain('/teams/flood-risk-team/test')
    })

    test('does not point to Test from Test itself', async () => {
      config.set('teamEnvironments', ['qa'])
      mockPage({
        deployments: [deployment({ environment: 'qa' })],
        credentials: [{ ...teamCredential, environment: 'qa' }]
      })

      const { result } = await page()

      expect(result).toContain('for Flood Risk Team, in Test')
      expect(result).not.toContain('set it up in Test')
    })
  })

  describe('when a model could not be set up', () => {
    function failedPage(overrides, options = {}) {
      mockPage({
        deployments: [
          deployment({
            _id: 'deployment-f',
            modelSlug: 'gpt-5-mini',
            status: 'deploy-failed',
            operationId: 'op-1234567-7f3k2',
            failureReason:
              'Apply: gpt-5-mini is not available in swedencentral',
            links: {
              pullRequest: 'https://github.com/DEFRA/tenants/pull/214',
              applyRun: 'https://github.com/DEFRA/tenants/actions/runs/9',
              submitRun: 'https://github.com/DEFRA/tenants/actions/runs/8'
            },
            ...overrides
          }),
          deployment({ _id: 'deployment-ok', modelSlug: 'gpt-4o' })
        ],
        ...options
      })

      return page('deployment-f')
    }

    test('names the model, says why in plain words and what is not affected', async () => {
      const { statusCode, result } = await failedPage()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('We could not set up GPT-5 mini')
      expect(result).toContain(
        'GPT-5 mini is not available to teams in the UK yet, so it could not be set up. It should not have been offered to you. GPT-4o is not affected.'
      )
      expect(result).not.toContain('http-equiv="refresh"')
    })

    test('an admin can remove it, use the model the team has, or ask for help quoting the reference', async () => {
      const { result } = await failedPage()

      expect(result).toContain('What you can do')
      expect(result).toContain(
        'href="/teams/flood-risk-team/models/deployment-f/remove">remove it from your team</a>'
      )
      expect(result).toContain('use GPT-4o, which your team already has')
      expect(result).toContain('ask the AI Platform team for help</a>')
      expect(result).toContain(
        'quoting reference <strong data-testid="support-reference">AIP-7F3K2</strong>'
      )
    })

    test('a member is told to ask an admin to remove it', async () => {
      mockPage({
        role: 'user',
        deployments: [deployment({ status: 'checks-failed' })]
      })

      const { result } = await page()

      expect(result).toContain(
        'ask an admin of Flood Risk Team to remove it from your team'
      )
      expect(result).not.toContain('/remove"')
    })

    test('has technical details, closed, with the reference, what failed and the links', async () => {
      const { result } = await failedPage()

      expect(result).toContain('Technical details for the AI Platform team')
      expect(result).toMatch(/<details[^>]*data-testid="technical-details"/)
      expect(result).not.toMatch(/<details[^>]*\sopen/)
      expect(result).toContain('Reference')
      expect(result).toContain('AIP-7F3K2')
      expect(result).toContain('What failed')
      expect(result).toContain(
        'Apply: gpt-5-mini is not available in swedencentral'
      )
      expect(result).toContain(
        '<a class="govuk-link" href="https://github.com/DEFRA/tenants/pull/214">Pull request</a>'
      )
      expect(result).toContain(
        '<a class="govuk-link" href="https://github.com/DEFRA/tenants/actions/runs/9">Apply run</a>'
      )
      expect(result).not.toContain('actions/runs/8')
    })

    test('shows only https links', async () => {
      const { result } = await failedPage({
        links: { pullRequest: 'javascript:alert(1)' }
      })

      expect(result).not.toContain('javascript:alert')
      expect(result).not.toContain('Pull request')
    })

    test('says a model in the UK could not be set up, without blaming the offer', async () => {
      mockPage({
        deployments: [deployment({ status: 'checks-failed' })]
      })

      const { result } = await page()

      expect(result).toContain(
        'GPT-4o could not be set up for Flood Risk Team.'
      )
      expect(result).not.toContain('should not have been offered')
      expect(result).not.toContain('not affected')
      expect(result).not.toContain('which your team already has')
    })

    test('says the resources were created when they could not be confirmed', async () => {
      mockPage({
        deployments: [
          deployment({
            status: 'deploy-failed',
            verificationFailure: {
              reason: 'environment-not-configured',
              attempts: 5
            }
          })
        ]
      })

      const { result } = await page()

      expect(result).toContain(
        'GPT-4o was created for Flood Risk Team, but we could not confirm it is working.'
      )
    })

    test('asks for help without a reference when the deployment has none', async () => {
      mockPage({
        deployments: [
          deployment({ status: 'checks-failed', operationId: undefined })
        ]
      })

      const { result } = await page()

      expect(result).toContain('ask the AI Platform team for help</a>')
      expect(result).not.toContain('quoting reference')
      expect(result).not.toContain('AIP-')
    })

    test('names a model by its slug when the catalogue no longer lists it', async () => {
      mockPage({
        catalogue: [],
        deployments: [deployment({ status: 'checks-failed' })]
      })

      const { result } = await page()

      expect(result).toContain('We could not set up gpt-4o')
      expect(result).toContain(
        'gpt-4o could not be set up for Flood Risk Team.'
      )
    })
  })

  describe('who can see it', () => {
    test('shows a not found page to a person with only their own keys, who is not in the team', async () => {
      mockResponse(NOT_FOUND, { status: 404 })

      const { statusCode, result } = await page()

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Request not found')
      expect(calledWith('/deployments')).toBe(false)
    })

    test('shows a not found page when the backend refuses the team', async () => {
      mockResponse(
        { statusCode: 403, error: 'Forbidden', message: 'Forbidden' },
        { status: 403 }
      )

      const { statusCode, result } = await page()

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Request not found')
    })

    test('shows a not found page when the team has no deployments the person can see', async () => {
      mockResponse(teamWithMembers())
      mockResponse(NOT_FOUND, { status: 404 })

      const { statusCode } = await page()

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('shows a not found page for a deployment the team does not have', async () => {
      mockResponse(teamWithMembers())
      mockResponse({ items: [deployment({ _id: 'another-deployment' })] })

      const { statusCode, result } = await page('unknown-deployment')

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Request not found')
    })

    test('lets a fault in finding the team through', async () => {
      mockResponse({ message: 'Broken', code: 'error' }, { status: 500 })

      const { statusCode } = await page()

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('sends someone who is signed out to sign in', async () => {
      const { statusCode, headers } = await get(
        server,
        {},
        '/connect/team/request/flood-risk-team/deployment-1'
      )

      expect(statusCode).toBe(302)
      expect(headers.location).toContain('/sign-in')
    })

    test.each(['removing', 'removed'])(
      'sends a %s deployment to its team page, where the removal is shown',
      async (status) => {
        mockResponse(teamWithMembers())
        mockResponse({ items: [deployment({ status })] })

        const { statusCode, headers } = await page()

        expect(statusCode).toBe(statusCodes.seeOther)
        expect(headers.location).toBe('/teams/flood-risk-team')
      }
    )

    test('is a page of its own: the old credential page is gone', async () => {
      const { statusCode } = await get(
        server,
        cookies,
        '/connect/team/credential'
      )

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('reads the team from whatever the address names, its id as well as its slug', async () => {
      mockResponse(teamWithMembers())
      mockResponse({ items: [deployment({ status: 'deploying' })] })
      mockResponse({ items: [sampleModel] })

      const { statusCode } = await get(
        server,
        cookies,
        '/connect/team/request/team-1/deployment-1'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(calledWith('/v1/teams/team-1/deployments')).toBe(true)
    })
  })
})

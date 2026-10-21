import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
  nanoModel,
  sampleModel,
  sampleTeam,
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

const {
  mockResponse,
  mockModelChoices,
  post,
  get,
  reachTeamStep,
  reachDetails,
  reachCheckStep,
  lastRequest
} = teamConnectHelpers(fetchMock)

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
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

    const { statusCode, headers } = await get(
      server,
      cookies,
      '/connect/team/select'
    )

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/connect')
  })

  test('GET /connect/team/select redirects to /teams/new when the user has no teams', async () => {
    let cookies = await signIn(server)
    cookies = mergeCookies(
      cookies,
      await post(server, cookies, '/connect', { accessType: 'team' })
    )
    mockResponse({ items: [] })

    const { statusCode, headers } = await get(
      server,
      cookies,
      '/connect/team/select'
    )

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(
      '/teams/new?returnTo=%2Fconnect%2Fteam%2Fselect'
    )
  })

  test('POST /connect/team/select with no team re-renders with an error', async () => {
    let cookies = await signIn(server)
    cookies = mergeCookies(
      cookies,
      await post(server, cookies, '/connect', { accessType: 'team' })
    )
    mockResponse({ items: [sampleTeam] })

    const { statusCode, result } = await post(
      server,
      cookies,
      '/connect/team/select',
      {}
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  describe('the model step', () => {
    test('offers every team model as a checkbox', async () => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices({ models: [sampleModel, nanoModel] })

      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/model'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('type="checkbox"')
      expect(result).toContain('value="gpt-4o"')
      expect(result).toContain('value="gpt-4-1-nano"')
      expect(result).toContain('Select all that apply')
      expect(result).not.toMatch(/value="gpt-4o"[^>]*checked/)
    })

    test('ticks the model the person came from on its page', async () => {
      const cookies = await reachTeamStep(server, await signIn(server), {
        modelSlug: 'gpt-4-1-nano'
      })
      mockModelChoices({ models: [sampleModel, nanoModel] })

      const { result } = await get(server, cookies, '/connect/team/model')

      expect(result).toMatch(/value="gpt-4-1-nano"[^>]*checked/)
      expect(result).not.toMatch(/value="gpt-4o"[^>]*checked/)
    })

    test('does not offer a model the team already has for choosing, or tick it', async () => {
      const cookies = await reachTeamStep(server, await signIn(server), {
        modelSlug: 'gpt-4o'
      })
      mockModelChoices({
        models: [sampleModel, nanoModel],
        deployments: [{ modelSlug: 'gpt-4o', status: 'active' }]
      })

      const { result } = await get(server, cookies, '/connect/team/model')

      expect(result).toMatch(/value="gpt-4o"[^>]*disabled/)
      expect(result).not.toMatch(/value="gpt-4o"[^>]*checked/)
      expect(result).toContain('Already set up for this team')
    })

    test('offers a model the team removed again', async () => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices({
        deployments: [{ modelSlug: 'gpt-4o', status: 'removed' }]
      })

      const { result } = await get(server, cookies, '/connect/team/model')

      expect(result).not.toMatch(/value="gpt-4o"[^>]*disabled/)
    })

    test.each([
      ['a list of models', { modelSlugs: ['gpt-4o', 'gpt-4-1-nano'] }],
      ['a single model sent as a string', { modelSlugs: 'gpt-4o' }]
    ])('accepts %s and goes on to the details', async (_name, payload) => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices({ models: [sampleModel, nanoModel] })

      const { statusCode, headers } = await post(
        server,
        cookies,
        '/connect/team/model',
        payload
      )

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/connect/team/details')
    })

    test('accepts several models sent as a form, one field each', async () => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices({ models: [sampleModel, nanoModel] })

      const { statusCode } = await server.inject({
        method: 'POST',
        url: '/connect/team/model',
        headers: {
          cookie: cookieHeader(cookies),
          'content-type': 'application/x-www-form-urlencoded'
        },
        payload: `crumb=${cookies.crumb}&modelSlugs=gpt-4o&modelSlugs=gpt-4-1-nano`
      })

      expect(statusCode).toBe(statusCodes.seeOther)
    })

    test('keeps the ticks and says what is wrong when nothing is chosen', async () => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices({ models: [sampleModel, nanoModel] })

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/model',
        {}
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Select at least one model')
      expect(result).toContain('Error: Choose your models')
    })

    test.each([
      [
        'the same model twice',
        ['gpt-4o', 'gpt-4o'],
        'Select each model only once'
      ],
      ['a name that is not a slug', ['GPT 4o'], 'Select models from the list'],
      [
        'too many models',
        Array.from({ length: 21 }, (_, index) => `model-${index}`),
        'Select no more than 20 models'
      ]
    ])('refuses %s', async (_name, modelSlugs, message) => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices()

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/model',
        { modelSlugs }
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain(message)
    })

    test.each([
      ['a model that is not on offer', ['gpt-4o', 'not-a-model'], []],
      [
        'a model the team has been given since the page was shown',
        ['gpt-4o'],
        [{ modelSlug: 'gpt-4o', status: 'active' }]
      ]
    ])('refuses %s', async (_name, modelSlugs, deployments) => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices({ deployments })

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/model',
        { modelSlugs }
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Select models from the list')
    })

    test('sends someone with no team chosen back to the start', async () => {
      const cookies = await signIn(server)

      const { statusCode, headers } = await get(
        server,
        cookies,
        '/connect/team/model'
      )

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/connect')
    })
  })

  describe('the environment on the details step', () => {
    const configured = config.get('teamEnvironments')

    afterEach(() => {
      config.set('teamEnvironments', configured)
    })

    test('states the environment the models are set up in, with nothing to choose', async () => {
      const cookies = await reachDetails(server, await signIn(server))

      const { result } = await get(server, cookies, '/connect/team/details')

      expect(result).toContain('Your models will be set up in Development.')
      expect(result).not.toContain('name="environment"')
    })

    test('states the first available environment, in order, whatever is configured', async () => {
      config.set('teamEnvironments', ['prod', 'qa'])
      const cookies = await reachDetails(server, await signIn(server))

      const { result } = await get(server, cookies, '/connect/team/details')

      expect(result).toContain('Your models will be set up in Test.')
    })

    test('states the environment again when the purpose fails validation', async () => {
      const cookies = await reachDetails(server, await signIn(server))

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/details',
        { purpose: 'x'.repeat(501) }
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Your models will be set up in Development.')
    })

    describe('when no environment is available to teams', () => {
      beforeEach(() => {
        config.set('teamEnvironments', ['sandbox'])
      })

      test('says so instead of showing the details form', async () => {
        const cookies = await reachDetails(server, await signIn(server))

        const { statusCode, result } = await get(
          server,
          cookies,
          '/connect/team/details'
        )

        expect(statusCode).toBe(statusCodes.serviceUnavailable)
        expect(result).toContain('No environment is available yet')
        expect(result).not.toContain('name="purpose"')
      })

      test('says so, and saves nothing, when valid details are posted', async () => {
        const cookies = await reachDetails(server, await signIn(server))

        const { statusCode, result } = await post(
          server,
          cookies,
          '/connect/team/details',
          { purpose: 'x' }
        )

        expect(statusCode).toBe(statusCodes.serviceUnavailable)
        expect(result).toContain('No environment is available yet')
      })

      test('says so, not the form, when invalid details are posted', async () => {
        const cookies = await reachDetails(server, await signIn(server))

        const { statusCode, result } = await post(
          server,
          cookies,
          '/connect/team/details',
          { purpose: 'x'.repeat(501) }
        )

        expect(statusCode).toBe(statusCodes.serviceUnavailable)
        expect(result).toContain('No environment is available yet')
      })
    })

    test('refuses an environment posted from the form, as it is not chosen', async () => {
      const cookies = await reachDetails(server, await signIn(server))

      const { statusCode } = await post(
        server,
        cookies,
        '/connect/team/details',
        { purpose: 'x', environment: 'prod' }
      )

      expect(statusCode).toBe(statusCodes.badRequest)
    })
  })
  describe('the check step', () => {
    test('summarises every model chosen and requests them all on confirm', async () => {
      const cookies = await reachCheckStep(server, await signIn(server), [
        'gpt-4o',
        'gpt-4-1-nano'
      ])

      mockResponse(sampleModel)
      mockResponse(nanoModel)
      const getCheck = await get(server, cookies, '/connect/team/check')

      expect(getCheck.result).toContain('GPT-4o')
      expect(getCheck.result).toContain('GPT-4.1 nano')
      expect(getCheck.result).toContain('They are set up one after another.')

      mockResponse({
        deployments: [
          { _id: 'deployment-1', status: 'requested' },
          { _id: 'deployment-2', status: 'queued' }
        ]
      })
      const postCheck = await post(server, cookies, '/connect/team/check', {})

      expect(postCheck.statusCode).toBe(statusCodes.seeOther)
      // The first model's page follows the whole request.
      expect(postCheck.headers.location).toBe(
        '/connect/team/request/team-1/deployment-1'
      )
      const { url, init, body } = lastRequest()

      expect(url).toContain('/v1/teams/team-1/deployments')
      expect(body).toEqual({
        modelSlugs: ['gpt-4o', 'gpt-4-1-nano'],
        environment: 'infradev'
      })
      expect(init.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    })

    test('says nothing about ordering for a single model', async () => {
      const cookies = await reachCheckStep(server, await signIn(server))

      mockResponse(sampleModel)
      const { result } = await get(server, cookies, '/connect/team/check')

      expect(result).not.toContain('one after another')
    })

    test('replays one request, not a second, when the same answers are confirmed again', async () => {
      const cookies = await reachCheckStep(server, await signIn(server))
      const conflict = {
        statusCode: 409,
        error: 'Conflict',
        message: 'A deployment already exists for this team and model',
        code: 'deployment-exists',
        existingId: 'deployment-1'
      }

      mockResponse(conflict, { status: 409 })
      mockResponse(sampleModel)
      await post(server, cookies, '/connect/team/check', {})
      const first = lastKey(fetchMock.mock.calls.find(isDeploymentPost))

      mockResponse(conflict, { status: 409 })
      mockResponse(sampleModel)
      await post(server, cookies, '/connect/team/check', {})
      const second = lastKey(fetchMock.mock.calls.findLast(isDeploymentPost))

      expect(first).toBeTruthy()
      expect(second).toBe(first)
    })

    test('uses a new key once the answers are given again', async () => {
      let cookies = await reachCheckStep(server, await signIn(server))
      const conflict = {
        statusCode: 409,
        error: 'Conflict',
        message: 'x',
        code: 'deployment-exists',
        existingId: 'deployment-1'
      }

      mockResponse(conflict, { status: 409 })
      mockResponse(sampleModel)
      await post(server, cookies, '/connect/team/check', {})
      const first = lastKey(fetchMock.mock.calls.find(isDeploymentPost))

      cookies = mergeCookies(
        cookies,
        await post(server, cookies, '/connect/team/details', {
          purpose: 'Changed my mind'
        })
      )
      mockResponse(conflict, { status: 409 })
      mockResponse(sampleModel)
      await post(server, cookies, '/connect/team/check', {})
      const second = lastKey(fetchMock.mock.calls.findLast(isDeploymentPost))

      expect(second).not.toBe(first)
    })

    test('shows a link to the existing request on a 409', async () => {
      const cookies = await reachCheckStep(server, await signIn(server))

      mockResponse(
        {
          statusCode: 409,
          error: 'Conflict',
          message: 'A deployment already exists for this team and model',
          code: 'deployment-exists',
          existingId: 'deployment-1'
        },
        { status: 409 }
      )
      mockResponse(sampleModel)

      const postCheck = await post(server, cookies, '/connect/team/check', {})

      expect(postCheck.statusCode).toBe(statusCodes.conflict)
      expect(postCheck.result).toContain(
        'Your team already has one of these models.'
      )
      expect(postCheck.result).toContain(
        '/connect/team/request/team-1/deployment-1'
      )
    })

    test('sends a journey that is not finished back to the start', async () => {
      const cookies = await reachDetails(server, await signIn(server))

      const checkPage = await get(server, cookies, '/connect/team/check')
      const confirm = await post(server, cookies, '/connect/team/check', {})

      expect(checkPage.headers.location).toBe('/connect')
      expect(confirm.headers.location).toBe('/connect')
    })
  })

  describe('what a journey leaves in the session', () => {
    test('is cleared once the request is made, so it does not seed the next one', async () => {
      let cookies = await reachCheckStep(server, await signIn(server))

      mockResponse({
        deployments: [{ _id: 'deployment-1', status: 'requested' }]
      })
      cookies = mergeCookies(
        cookies,
        await post(server, cookies, '/connect/team/check', {})
      )

      const checkAgain = await get(server, cookies, '/connect/team/check')
      const modelAgain = await get(server, cookies, '/connect/team/model')
      const start = await get(server, cookies, '/connect')

      expect(checkAgain.headers.location).toBe('/connect')
      expect(modelAgain.headers.location).toBe('/connect')
      expect(start.result).not.toContain('value="gpt-4o"')
    })

    test('is dropped when someone else signs in on the same session', async () => {
      let cookies = await reachDetails(server, await signIn(server))

      mockResponse({
        user: {
          _id: 'user-2',
          email: 'someone.else@defra.gov.uk',
          displayName: 'Someone Else'
        },
        team: null
      })
      cookies = mergeCookies(
        cookies,
        await server.inject({
          method: 'GET',
          url: '/auth/login',
          headers: { cookie: cookieHeader(cookies) }
        })
      )
      cookies = mergeCookies(
        cookies,
        await server.inject({
          method: 'GET',
          url: '/auth/callback?code=abc&state=state-123',
          headers: { cookie: cookieHeader(cookies) }
        })
      )

      const details = await get(server, cookies, '/connect/team/details')
      const model = await get(server, cookies, '/connect/team/model')

      expect(details.headers.location).toBe('/connect')
      expect(model.headers.location).toBe('/connect')
    })
  })
})

function isDeploymentPost([url, init]) {
  return url.endsWith('/v1/teams/team-1/deployments') && init.method === 'POST'
}

function lastKey([, init]) {
  return init.headers['idempotency-key']
}

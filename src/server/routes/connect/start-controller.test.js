import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  mergeCookies
} from '#/test-helpers/oidc-session-helpers.js'
import {
  nanoModel,
  sampleModel,
  sampleTeam,
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
    access_token: 'user-access-token',
    refresh_token: 'user-refresh-token',
    expires_in: 3600,
    claims: () => ({
      preferred_username: 'test.user@defra.gov.uk',
      email: 'test.user@defra.gov.uk',
      name: 'Test User'
    })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const {
  mockResponse,
  get,
  post,
  lastRequest,
  reachTeamStep,
  mockModelChoices,
  mockTeamChoices
} = teamConnectHelpers(fetchMock)

describe('#startController', () => {
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

  describe('when signed out', () => {
    test.each([
      ['/connect/shared/start', '%2Fconnect%2Fshared%2Fstart'],
      ['/connect/team/start', '%2Fconnect%2Fteam%2Fstart']
    ])('GET %s sends the person to sign in', async (url, returnTo) => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe(`/sign-in?returnTo=${returnTo}`)
    })

    test('GET /connect/team/start keeps the model through signing in', async () => {
      const { headers } = await server.inject({
        method: 'GET',
        url: '/connect/team/start?modelSlug=gpt-4o'
      })

      expect(headers.location).toBe(
        '/sign-in?returnTo=%2Fconnect%2Fteam%2Fstart%3FmodelSlug%3Dgpt-4o'
      )
    })
  })

  describe('Try it on your own', () => {
    function mockResearchModels(models) {
      mockResponse({ items: models })
    }

    test('GET /connect/shared/start goes to the model step when no model is given', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode, headers } = await get(
        server,
        cookies,
        '/connect/shared/start'
      )

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/connect/shared/model')
    })

    test('GET /connect/shared/start skips to the details when a model is given, and keeps it', async () => {
      let cookies = await signInViaOidc(server, fetchMock)

      mockResearchModels([sampleModel])
      const start = await get(
        server,
        cookies,
        '/connect/shared/start?modelSlug=gpt-4o'
      )
      cookies = mergeCookies(cookies, start)

      expect(start.statusCode).toBe(statusCodes.found)
      expect(start.headers.location).toBe('/connect/shared/details')
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/models$/),
        expect.anything()
      )

      mockResponse(sampleModel)
      const details = await get(server, cookies, '/connect/shared/details')

      expect(details.statusCode).toBe(statusCodes.ok)
      expect(details.result).toContain('What will you use GPT-4o for?')
    })

    test('GET /connect/shared/start?modelSlug= refuses a model research has not deployed, and starts no journey', async () => {
      let cookies = await signInViaOidc(server, fetchMock)

      mockResearchModels([{ ...sampleModel, researchAvailable: false }])
      const start = await get(
        server,
        cookies,
        '/connect/shared/start?modelSlug=gpt-4o'
      )
      cookies = mergeCookies(cookies, start)

      expect(start.statusCode).toBe(statusCodes.notFound)
      expect(start.result).toContain(
        'This model is not available to try on your own yet.'
      )

      const details = await get(server, cookies, '/connect/shared/details')

      expect(details.headers.location).toBe('/models')
    })

    test('GET /connect/shared/start?modelSlug= refuses a model the catalogue does not list', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      mockResearchModels([sampleModel])
      const { statusCode } = await get(
        server,
        cookies,
        '/connect/shared/start?modelSlug=gpt-5-nano'
      )

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('GET /connect/shared/start?modelSlug= does not hide a failed read of what research has deployed', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      mockResponse(
        {
          code: 'research-deployments-unavailable',
          message: 'Cannot read'
        },
        { status: 502 }
      )
      const { statusCode } = await get(
        server,
        cookies,
        '/connect/shared/start?modelSlug=gpt-4o'
      )

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('GET /connect/shared/start leaves no model ticked on the model step when none was given', async () => {
      let cookies = await signInViaOidc(server, fetchMock)
      cookies = mergeCookies(
        cookies,
        await get(server, cookies, '/connect/shared/start')
      )

      mockResponse({ items: [sampleModel] })
      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/shared/model'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toContain('checked')
    })

    test('GET /connect/shared/start drops a team journey left in the session', async () => {
      let cookies = await reachTeamStep(
        server,
        await signInViaOidc(server, fetchMock),
        { modelSlug: 'gpt-4o' }
      )
      cookies = mergeCookies(
        cookies,
        await get(server, cookies, '/connect/shared/start')
      )

      const { headers } = await get(server, cookies, '/connect/team/model')

      expect(headers.location).toBe('/models')
    })
  })

  describe('Add to a team', () => {
    test('GET /connect/team/start goes to choosing a team', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode, headers } = await get(
        server,
        cookies,
        '/connect/team/start'
      )

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/connect/team/select')
    })

    test('GET /connect/team/start?modelSlug= carries the model to the model step, ticked', async () => {
      const cookies = await reachTeamStep(
        server,
        await signInViaOidc(server, fetchMock),
        { modelSlug: 'gpt-4o' }
      )

      mockModelChoices({ models: [sampleModel, nanoModel] })
      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/model'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(/value="gpt-4o"[^>]*checked/)
    })

    test('GET /connect/team/start offers whichever teams the person belongs to', async () => {
      let cookies = await signInViaOidc(server, fetchMock)
      cookies = mergeCookies(
        cookies,
        await get(server, cookies, '/connect/team/start')
      )

      mockTeamChoices({
        teams: [
          sampleTeam,
          {
            _id: 'team-2',
            slug: 'waste-crime-team',
            name: 'Waste Crime Team',
            role: 'user'
          }
        ]
      })
      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/select'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Flood Risk Team')
      expect(result).toContain('Waste Crime Team')
    })

    test('GET /connect/team/start sends a person with no team to create one', async () => {
      let cookies = await signInViaOidc(server, fetchMock)
      cookies = mergeCookies(
        cookies,
        await get(server, cookies, '/connect/team/start')
      )

      mockTeamChoices({ teams: [] })
      const { headers } = await get(server, cookies, '/connect/team/select')

      expect(headers.location).toBe(
        '/teams/new?returnTo=%2Fconnect%2Fteam%2Fselect'
      )
    })
  })

  describe('a model that is not a slug', () => {
    test.each([
      '/connect/shared/start?modelSlug=GPT 4o',
      '/connect/team/start?modelSlug=../admin',
      '/connect/team/start?modelSlug='
    ])('GET %s is refused', async (url) => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode } = await get(server, cookies, encodeURI(url))

      expect(statusCode).toBe(statusCodes.badRequest)
    })

    test('GET /connect/team/start refuses any other query', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode } = await get(
        server,
        cookies,
        '/connect/team/start?nonsense=team-1'
      )

      expect(statusCode).toBe(statusCodes.badRequest)
    })

    test.each([
      '/connect/team/start?environment=infradev',
      '/connect/team/start?teamId=',
      '/connect/team/start?teamId=flood-risk-team&environment=',
      '/connect/team/start?teamId=Flood Risk&environment=infradev'
    ])('GET %s is refused', async (url) => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode } = await get(server, cookies, encodeURI(url))

      expect(statusCode).toBe(statusCodes.badRequest)
    })
  })

  describe('Deploy a model, from the Environments section, with the team and environment chosen', () => {
    const START = `/connect/team/start?teamId=${sampleTeam.slug}&environment=infradev`
    const configured = config.get('teamEnvironments')

    afterEach(() => {
      config.set('teamEnvironments', configured)
    })

    async function started(url = START, role = 'admin') {
      const cookies = await signInViaOidc(server, fetchMock)

      mockResponse(teamWithMembers(role))
      const response = await get(server, cookies, url)

      return { response, cookies: mergeCookies(cookies, response) }
    }

    test('lands on the model step without asking for the team or the environment', async () => {
      const { response, cookies } = await started()

      expect(response.statusCode).toBe(statusCodes.found)
      expect(response.headers.location).toBe('/connect/team/model')
      // Only the team is read, to prove the person is a member of it.
      expect(fetchMock.mock.calls.at(-1)[0]).toContain(
        `/v1/teams/${sampleTeam.slug}`
      )

      mockModelChoices({ models: [sampleModel, nanoModel] })
      const model = await get(server, cookies, '/connect/team/model')
      const $ = load(model.result)

      expect(model.statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="app-heading-caption"]').text()).toBe(
        'Flood Risk Team'
      )
      expect($('legend').text()).toContain('Which models does your team need?')
      expect($('a.govuk-back-link').attr('href')).toBe(
        `/environments/${sampleTeam.slug}/infradev`
      )
    })

    test('asks what it is for, then checks the answers with no way to change the team, and requests in that environment', async () => {
      const { cookies: started1 } = await started()

      mockModelChoices({ models: [sampleModel, nanoModel] })
      const chosen = mergeCookies(
        started1,
        await post(server, started1, '/connect/team/model', {
          modelSlugs: ['gpt-4o']
        })
      )
      const details = await get(server, chosen, '/connect/team/details')

      expect(details.result).toContain('It will be set up in Development.')

      const answered = mergeCookies(
        chosen,
        await post(server, chosen, '/connect/team/details', {
          purpose: 'Flood alerts'
        })
      )

      mockResponse(sampleModel)
      const check = await get(server, answered, '/connect/team/check')
      const $ = load(check.result)

      expect(check.statusCode).toBe(statusCodes.ok)
      expect($('.govuk-summary-list__key').first().text().trim()).toBe('Team')
      expect($('a[href^="/connect/team/select"]')).toHaveLength(0)
      expect(check.result).toMatch(
        /Environment\s*<\/dt>\s*<dd[^>]*>\s*Development\s*<\/dd>/
      )

      mockResponse({
        deployments: [
          {
            _id: 'deployment-1',
            teamId: 'team-1',
            modelSlug: 'gpt-4o',
            environment: 'infradev',
            status: 'requested'
          }
        ]
      })
      const confirmed = await post(server, answered, '/connect/team/check', {})

      expect(confirmed.statusCode).toBe(statusCodes.seeOther)
      expect(lastRequest().body).toEqual({
        modelSlugs: ['gpt-4o'],
        environment: 'infradev'
      })
    })

    test('goes back from the model step and from the details step (when the model step was skipped) to the environment page', async () => {
      const { cookies } = await started(`${START}&modelSlug=gpt-4o`)

      mockModelChoices({ models: [sampleModel] })
      const skipped = await get(server, cookies, '/connect/team/model')

      // One model, from its page: the step is skipped.
      expect(skipped.headers.location).toBe('/connect/team/details')

      const jar = mergeCookies(cookies, skipped)
      const details = await get(server, jar, '/connect/team/details')

      expect(load(details.result)('a.govuk-back-link').attr('href')).toBe(
        `/environments/${sampleTeam.slug}/infradev`
      )
    })

    test('with no environment, starts in the first available one and goes back to the overview', async () => {
      const { response, cookies } = await started(
        `/connect/team/start?teamId=${sampleTeam.slug}`
      )

      expect(response.headers.location).toBe('/connect/team/model')

      mockModelChoices({ models: [sampleModel, nanoModel] })
      const model = await get(server, cookies, '/connect/team/model')

      expect(load(model.result)('a.govuk-back-link').attr('href')).toBe(
        `/environments/${sampleTeam.slug}`
      )
    })

    test.each(['qa', 'preprod', 'nowhere'])(
      'is a 404 for %s, which is not an available environment, and starts no journey',
      async (environment) => {
        const { response, cookies } = await started(
          `/connect/team/start?teamId=${sampleTeam.slug}&environment=${environment}`
        )

        expect(response.statusCode).toBe(statusCodes.notFound)
        expect(response.result).toContain('Environment not found')
        // Nothing was read: the environment is refused before the team is.
        expect(fetchMock.mock.calls.at(-1)[0]).not.toContain('/v1/teams/')

        const model = await get(server, cookies, '/connect/team/model')

        expect(model.headers.location).toBe('/models')
      }
    )

    test('is a 404 for a team the person is not a member of, and starts no journey', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      fetchMock.mockResponseOnce(JSON.stringify({ code: 'not-found' }), {
        status: 404
      })
      const response = await get(server, cookies, START)

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(response.result).toContain('Team not found')

      const model = await get(
        server,
        mergeCookies(cookies, response),
        '/connect/team/model'
      )

      expect(model.headers.location).toBe('/models')
    })
  })
})

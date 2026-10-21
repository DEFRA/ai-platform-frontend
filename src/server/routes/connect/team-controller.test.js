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
  abroadModel,
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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const {
  mockResponse,
  mockTeamChoices,
  mockModelChoices,
  post,
  get,
  reachTeamStep,
  reachDetails,
  reachCheckStep,
  lastRequest
} = teamConnectHelpers(fetchMock)

const NEW_TEAM_URL = '/teams/new?returnTo=%2Fconnect%2Fteam%2Fselect'

const NOT_FOUND = { statusCode: 404, error: 'Not Found', message: 'Not Found' }

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
}

function backLink(result, href) {
  return result.includes(`href="${href}" class="govuk-back-link"`)
}

function isDeploymentPost([url, init]) {
  return (
    url.endsWith('/v1/teams/flood-risk-team/deployments') &&
    init.method === 'POST'
  )
}

function lastKey([, init]) {
  return init.headers['idempotency-key']
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

  describe('the team step', () => {
    async function started(modelSlug) {
      const query = modelSlug ? `?modelSlug=${modelSlug}` : ''
      const cookies = await signIn(server)

      return mergeCookies(
        cookies,
        await get(server, cookies, `/connect/team/start${query}`)
      )
    }

    test('redirects to /models without a journey', async () => {
      const cookies = await signIn(server)

      const { statusCode, headers } = await get(
        server,
        cookies,
        '/connect/team/select'
      )

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/models')
    })

    test('sends a person with only their own keys, who is in no team, to create one', async () => {
      const cookies = await started()
      mockTeamChoices({ teams: [] })

      const { statusCode, headers } = await get(
        server,
        cookies,
        '/connect/team/select'
      )

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe(NEW_TEAM_URL)
    })

    test('asks which team, one radio each with the role and what the team has, then "or" and "Create a team"', async () => {
      const cookies = await started()
      const memberTeam = {
        ...sampleTeam,
        _id: 'team-2',
        slug: 'plant-health-data',
        name: 'Plant health data',
        role: 'user'
      }
      const newTeam = {
        ...sampleTeam,
        _id: 'team-3',
        slug: 'fish-export-checks',
        name: 'Fish export checks',
        createdAt: new Date().toISOString()
      }
      const quietTeam = {
        ...sampleTeam,
        _id: 'team-4',
        slug: 'old-team',
        name: 'Old team'
      }
      mockTeamChoices({
        teams: [sampleTeam, memberTeam, newTeam, quietTeam],
        deployments: [
          [
            {
              modelSlug: 'gpt-4o',
              status: 'active',
              environment: 'infradev'
            },
            {
              modelSlug: 'gpt-4-1-nano',
              status: 'deploying',
              environment: 'infradev'
            },
            {
              modelSlug: 'gpt-5-mini',
              status: 'removed',
              environment: 'infradev'
            }
          ],
          [{ modelSlug: 'gpt-4o', status: 'active', environment: 'infradev' }],
          [],
          [{ modelSlug: 'gpt-4o', status: 'active', environment: 'qa' }]
        ]
      })

      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/select'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Which team is this for?')
      expect(result).toContain('name="team"')
      expect(result).toContain(
        'You are an admin. Has GPT-4o and GPT-4.1 nano in Development.'
      )
      expect(result).toContain('You are a member. Has GPT-4o in Development.')
      expect(result).toContain(
        'You are an admin. Created today, no models yet.'
      )
      expect(result).toContain('You are an admin. No models yet.')
      expect(result).toContain('value="plant-health-data"')
      expect(result).toContain('govuk-radios__divider')
      expect(result).toContain('>or<')
      expect(result).toMatch(/Create a team\s*<\/label>/)
      expect(result).not.toMatch(/name="team"[^>]*checked/)
      expect(backLink(result, '/models')).toBe(true)
    })

    test('goes back to the model page the person came from', async () => {
      const cookies = await started('gpt-4o')
      mockTeamChoices()

      const { result } = await get(server, cookies, '/connect/team/select')

      expect(backLink(result, '/models/gpt-4o')).toBe(true)
    })

    test('says what is wrong when no team is chosen', async () => {
      const cookies = await started()
      mockTeamChoices()

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/select',
        {}
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('There is a problem')
      expect(result).toContain('Select a team')
      expect(result).toContain('Error: Which team is this for?')
    })

    test('refuses a team name that is not a team address', async () => {
      const cookies = await started()
      mockTeamChoices()

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/select',
        { team: 'Not A Team' }
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Select a team from the list')
    })

    test('refuses a team the person does not belong to', async () => {
      const cookies = await started()
      mockResponse(NOT_FOUND, { status: 404 })
      mockTeamChoices()

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/select',
        { team: 'someone-elses-team' }
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Select a team from the list')
    })

    test('does not hide a fault in finding the team', async () => {
      const cookies = await started()
      mockResponse({ message: 'Broken', code: 'error' }, { status: 500 })

      const { statusCode } = await post(
        server,
        cookies,
        '/connect/team/select',
        { team: 'flood-risk-team' }
      )

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('goes on to the models once a team is chosen', async () => {
      const cookies = await started()
      mockResponse(teamWithMembers())

      const { statusCode, headers } = await post(
        server,
        cookies,
        '/connect/team/select',
        { team: 'flood-risk-team' }
      )

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/connect/team/model')
    })

    test('"Create a team" goes to create one, and the new team comes back listed, not chosen, with the model the person came from still ticked', async () => {
      let cookies = await reachTeamStep(server, await signIn(server), {
        modelSlug: 'gpt-4-1-nano'
      })
      const newTeam = {
        _id: 'team-9',
        slug: 'fish-export-checks',
        name: 'Fish export checks',
        role: 'admin',
        createdAt: new Date().toISOString()
      }

      const create = await post(server, cookies, '/connect/team/select', {
        team: '+create'
      })

      expect(create.statusCode).toBe(statusCodes.seeOther)
      expect(create.headers.location).toBe(NEW_TEAM_URL)
      cookies = mergeCookies(cookies, create)

      // Through the create-a-team pages, returning to this journey.
      cookies = mergeCookies(
        cookies,
        await post(server, cookies, '/teams/new', {
          name: 'Fish export checks',
          serviceCode: 'FEC',
          returnTo: '/connect/team/select'
        })
      )
      mockResponse({ team: newTeam }, { status: 201 })
      const created = await post(server, cookies, '/teams/new/check', {})

      expect(created.statusCode).toBe(statusCodes.seeOther)
      expect(created.headers.location).toBe('/connect/team/select')
      cookies = mergeCookies(cookies, created)

      mockTeamChoices({ teams: [sampleTeam, newTeam] })
      const { result } = await get(server, cookies, '/connect/team/select')

      expect(result).toContain('value="fish-export-checks"')
      expect(result).toContain(
        'You are an admin. Created today, no models yet.'
      )
      expect(result).not.toMatch(/name="team"[^>]*checked/)

      mockResponse(teamWithMembers('admin', newTeam))
      cookies = mergeCookies(
        cookies,
        await post(server, cookies, '/connect/team/select', {
          team: 'fish-export-checks'
        })
      )
      mockModelChoices({ models: [sampleModel, nanoModel] })
      const models = await get(server, cookies, '/connect/team/model')

      expect(models.result).toContain('Fish export checks')
      expect(models.result).toMatch(/value="gpt-4-1-nano"[^>]*checked/)
    })

    test('chooses a team on the page it is changed from', async () => {
      const cookies = await reachCheckStep(server, await signIn(server))
      mockTeamChoices()

      const { result } = await get(
        server,
        cookies,
        '/connect/team/select?change=check'
      )

      expect(result).toMatch(/value="flood-risk-team"[^>]*checked/)
      expect(backLink(result, '/connect/team/check')).toBe(true)
    })

    test('returns to the check page when the same team is chosen again', async () => {
      const cookies = await reachCheckStep(server, await signIn(server))
      mockResponse(teamWithMembers())

      const { headers } = await post(
        server,
        cookies,
        '/connect/team/select?change=check',
        { team: 'flood-risk-team' }
      )

      expect(headers.location).toBe('/connect/team/check')
    })

    test('asks for the models again when another team is chosen, then returns to the check page', async () => {
      let cookies = await reachCheckStep(server, await signIn(server))
      const other = {
        ...sampleTeam,
        _id: 'team-2',
        slug: 'plant-health-data',
        name: 'Plant health data'
      }
      mockResponse(teamWithMembers('admin', other))

      const chosen = await post(
        server,
        cookies,
        '/connect/team/select?change=check',
        { team: 'plant-health-data' }
      )

      expect(chosen.headers.location).toBe('/connect/team/model?change=check')
      cookies = mergeCookies(cookies, chosen)

      // The answers are no longer complete: the old models were the old team's.
      const check = await get(server, cookies, '/connect/team/check')

      expect(check.headers.location).toBe('/models')

      // So Back from the models goes to the team, not to the check page.
      mockModelChoices({ models: [sampleModel, nanoModel] })
      const models = await get(
        server,
        cookies,
        '/connect/team/model?change=check'
      )

      expect(backLink(models.result, '/connect/team/select')).toBe(true)
      expect(backLink(models.result, '/connect/team/check')).toBe(false)

      mockTeamChoices({ teams: [other] })
      const back = await get(server, cookies, '/connect/team/select')

      expect(back.statusCode).toBe(statusCodes.ok)
    })

    test('refuses anything else in the address after change', async () => {
      const cookies = await started()

      const { statusCode } = await get(
        server,
        cookies,
        '/connect/team/select?change=elsewhere'
      )

      expect(statusCode).toBe(statusCodes.badRequest)
    })
  })

  describe('the model step', () => {
    test('offers the team models that run in the UK as checkboxes, with their use cases', async () => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices({ models: [sampleModel, nanoModel] })

      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/model'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Which models does your team need?')
      expect(result).toContain('Flood Risk Team')
      expect(result).toContain('Your team gets its own deployment of each one.')
      expect(result).toContain('type="checkbox"')
      expect(result).toContain('value="gpt-4o"')
      expect(result).toContain('value="gpt-4-1-nano"')
      expect(result).toContain('Chat assistants, summarising documents')
      expect(result).toContain('Classifying text')
      expect(result).not.toMatch(/value="gpt-4o"[^>]*checked/)
      expect(result).not.toContain('data-testid="not-in-uk"')
      expect(backLink(result, '/connect/team/select')).toBe(true)
    })

    test('asks the backend for the models the target environment can deploy', async () => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices()

      await get(server, cookies, '/connect/team/model')

      expect(
        fetchMock.mock.calls.some(([url]) =>
          url.endsWith('/v1/models?tier=team&environment=infradev')
        )
      ).toBe(true)
    })

    test('leaves out a model that does not run in the UK, and names it in an inset with a link to all models', async () => {
      const cookies = await reachTeamStep(server, await signIn(server))
      mockModelChoices({
        models: [sampleModel, abroadModel],
        catalogue: [sampleModel, abroadModel]
      })

      const { result } = await get(server, cookies, '/connect/team/model')

      expect(result).not.toContain('value="gpt-5-mini"')
      expect(result).toContain(
        'GPT-5 mini is not available to teams in the UK yet.'
      )
      expect(result).toContain('href="/models">See all models</a>')
    })

    test('names several models together in the inset', async () => {
      const cookies = await reachTeamStep(server, await signIn(server))
      const another = { ...abroadModel, slug: 'gpt-5', displayName: 'GPT-5' }
      mockModelChoices({
        models: [sampleModel],
        catalogue: [sampleModel, abroadModel, another]
      })

      const { result } = await get(server, cookies, '/connect/team/model')

      expect(result).toContain(
        'GPT-5 mini and GPT-5 are not available to teams in the UK yet.'
      )
    })

    test('ticks the model the person came from on its page when there are others', async () => {
      const cookies = await reachTeamStep(server, await signIn(server), {
        modelSlug: 'gpt-4-1-nano'
      })
      mockModelChoices({ models: [sampleModel, nanoModel] })

      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/model'
      )

      expect(statusCode).toBe(statusCodes.ok)
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

    describe('when exactly one model is offered and it came from its page', () => {
      test('skips the page, and the details step goes back to the team step', async () => {
        let cookies = await reachTeamStep(server, await signIn(server), {
          modelSlug: 'gpt-4o'
        })
        mockModelChoices({
          models: [sampleModel, nanoModel],
          deployments: [{ modelSlug: 'gpt-4-1-nano', status: 'active' }]
        })

        const skipped = await get(server, cookies, '/connect/team/model')

        expect(skipped.statusCode).toBe(statusCodes.seeOther)
        expect(skipped.headers.location).toBe('/connect/team/details')
        cookies = mergeCookies(cookies, skipped)

        const { result } = await get(server, cookies, '/connect/team/details')

        expect(backLink(result, '/connect/team/select')).toBe(true)

        // And from the team step, Back still goes to the model's own page.
        mockTeamChoices()
        const team = await get(server, cookies, '/connect/team/select')

        expect(backLink(team.result, '/models/gpt-4o')).toBe(true)
      })

      test('does not skip it when the model came from the Models page, not its own', async () => {
        const cookies = await reachTeamStep(server, await signIn(server))
        mockModelChoices({ models: [sampleModel] })

        const { statusCode } = await get(server, cookies, '/connect/team/model')

        expect(statusCode).toBe(statusCodes.ok)
      })

      test('does not skip it when the one model is not the one the person came from', async () => {
        const cookies = await reachTeamStep(server, await signIn(server), {
          modelSlug: 'gpt-4-1-nano'
        })
        mockModelChoices({ models: [sampleModel] })

        const { statusCode } = await get(server, cookies, '/connect/team/model')

        expect(statusCode).toBe(statusCodes.ok)
      })

      test('does not skip it when opened from Change on the check page', async () => {
        const cookies = await reachCheckStep(server, await signIn(server))
        mockModelChoices({ models: [sampleModel] })

        const { statusCode, result } = await get(
          server,
          cookies,
          '/connect/team/model?change=check'
        )

        expect(statusCode).toBe(statusCodes.ok)
        expect(backLink(result, '/connect/team/check')).toBe(true)
      })
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

    test('goes back to the model page the person came from, whatever they chose', async () => {
      let cookies = await reachTeamStep(server, await signIn(server), {
        modelSlug: 'gpt-4o'
      })
      mockModelChoices({ models: [sampleModel, nanoModel] })
      cookies = mergeCookies(
        cookies,
        await post(server, cookies, '/connect/team/model', {
          modelSlugs: ['gpt-4-1-nano']
        })
      )

      mockTeamChoices()
      const { result } = await get(server, cookies, '/connect/team/select')

      expect(backLink(result, '/models/gpt-4o')).toBe(true)
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
      expect(result).toContain('Error: Which models does your team need?')
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

      const page = await get(server, cookies, '/connect/team/model')
      const posted = await post(server, cookies, '/connect/team/model', {
        modelSlugs: ['gpt-4o']
      })

      expect(page.statusCode).toBe(302)
      expect(page.headers.location).toBe('/models')
      expect(posted.headers.location).toBe('/models')
    })

    test('sends someone with no team chosen back to the start when the form is wrong', async () => {
      const cookies = await signIn(server)

      const { headers } = await post(server, cookies, '/connect/team/model', {})

      expect(headers.location).toBe('/models')
    })

    test('returns to the check page, with a new key, when the models are changed from there', async () => {
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

      mockModelChoices({ models: [sampleModel, nanoModel] })
      const changed = await post(
        server,
        cookies,
        '/connect/team/model?change=check',
        { modelSlugs: ['gpt-4-1-nano'] }
      )

      expect(changed.statusCode).toBe(statusCodes.seeOther)
      expect(changed.headers.location).toBe('/connect/team/check')
      cookies = mergeCookies(cookies, changed)

      mockResponse(conflict, { status: 409 })
      mockResponse(nanoModel)
      await post(server, cookies, '/connect/team/check', {})
      const second = fetchMock.mock.calls.findLast(isDeploymentPost)

      expect(JSON.parse(second[1].body).modelSlugs).toEqual(['gpt-4-1-nano'])
      expect(lastKey(second)).not.toBe(first)
    })

    test('says what is wrong, still on the change, when nothing is chosen there', async () => {
      const cookies = await reachCheckStep(server, await signIn(server))
      mockModelChoices({ models: [sampleModel, nanoModel] })

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/model?change=check',
        {}
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(backLink(result, '/connect/team/check')).toBe(true)
    })
  })

  describe('the details step', () => {
    const configured = config.get('teamEnvironments')

    afterEach(() => {
      config.set('teamEnvironments', configured)
    })

    test('asks what the team will use it for, under the team name, with the environment stated and nothing to choose', async () => {
      const cookies = await reachDetails(server, await signIn(server))

      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/details'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('What will your team use it for? (optional)')
      expect(result).toContain('Flood Risk Team')
      expect(result).toContain(
        'For example, the service or piece of work it supports. This helps us plan capacity.'
      )
      expect(result).toContain(
        '<strong>It will be set up in Development.</strong>'
      )
      expect(result).toContain(
        'When it is working, you can set it up in Test and other environments from your team'
      )
      expect(result).toContain('data-maxlength="500"')
      expect(result).not.toContain('name="environment"')
      expect(backLink(result, '/connect/team/model')).toBe(true)
    })

    test('states the first available environment, in order, whatever is configured', async () => {
      config.set('teamEnvironments', ['prod', 'qa'])
      const cookies = await reachDetails(server, await signIn(server))

      const { result } = await get(server, cookies, '/connect/team/details')

      expect(result).toContain('<strong>It will be set up in Test.</strong>')
    })

    test('goes back to the check page when opened from Change there', async () => {
      const cookies = await reachCheckStep(server, await signIn(server))

      const { result } = await get(
        server,
        cookies,
        '/connect/team/details?change=check'
      )

      expect(backLink(result, '/connect/team/check')).toBe(true)
      expect(result).toContain('Journey test')
    })

    test('goes on to the check page', async () => {
      const cookies = await reachDetails(server, await signIn(server))

      const { statusCode, headers } = await post(
        server,
        cookies,
        '/connect/team/details',
        { purpose: 'Mapping' }
      )

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/connect/team/check')
    })

    test('accepts no answer, as it is optional', async () => {
      const cookies = await reachDetails(server, await signIn(server))

      const { statusCode } = await post(
        server,
        cookies,
        '/connect/team/details',
        { purpose: '' }
      )

      expect(statusCode).toBe(statusCodes.seeOther)
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
      expect(result).toContain('Purpose must be 500 characters or fewer')
      expect(result).toContain('It will be set up in Development.')
    })

    test('sends someone without a finished team and model choice back to the start', async () => {
      const cookies = await signIn(server)

      const page = await get(server, cookies, '/connect/team/details')
      const posted = await post(server, cookies, '/connect/team/details', {
        purpose: 'x'
      })
      const invalid = await post(server, cookies, '/connect/team/details', {
        purpose: 'x'.repeat(501)
      })

      expect(page.headers.location).toBe('/models')
      expect(posted.headers.location).toBe('/models')
      expect(invalid.headers.location).toBe('/models')
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
    test('summarises the answers, each with Change but the environment, and requests every model on confirm', async () => {
      const cookies = await reachCheckStep(server, await signIn(server), [
        'gpt-4o',
        'gpt-4-1-nano'
      ])

      mockResponse(sampleModel)
      mockResponse(nanoModel)
      const getCheck = await get(server, cookies, '/connect/team/check')

      expect(getCheck.statusCode).toBe(statusCodes.ok)
      expect(getCheck.result).toContain('Check your answers')
      expect(getCheck.result).toContain('Flood Risk Team')
      expect(getCheck.result).toContain('GPT-4o and GPT-4.1 nano')
      expect(getCheck.result).toContain('Journey test')
      expect(getCheck.result).toContain('Development')
      expect(getCheck.result).toContain('Now request access')
      expect(getCheck.result).toContain(
        'We will set up a deployment of GPT-4o and GPT-4.1 nano for your team. It usually takes about 2 minutes, and you can leave the page while it happens.'
      )
      expect(getCheck.result).toContain('Request access')
      expect(getCheck.result).toContain(
        'href="/connect/team/select?change=check"'
      )
      expect(getCheck.result).toContain(
        'href="/connect/team/model?change=check"'
      )
      expect(getCheck.result).toContain(
        'href="/connect/team/details?change=check"'
      )
      expect(getCheck.result.match(/>\s*Change/g)).toHaveLength(3)
      expect(backLink(getCheck.result, '/connect/team/details')).toBe(true)

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
        '/connect/team/request/flood-risk-team/deployment-1'
      )
      const { url, init, body } = lastRequest()

      expect(url).toContain('/v1/teams/flood-risk-team/deployments')
      expect(body).toEqual({
        modelSlugs: ['gpt-4o', 'gpt-4-1-nano'],
        environment: 'infradev'
      })
      expect(init.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    })

    test('shows what the person left the purpose as when it was not given', async () => {
      const cookies = await reachDetails(server, await signIn(server))
      const withoutPurpose = mergeCookies(
        cookies,
        await post(server, cookies, '/connect/team/details', { purpose: '' })
      )

      mockResponse(sampleModel)
      const { result } = await get(
        server,
        withoutPurpose,
        '/connect/team/check'
      )

      expect(result).toContain('Not given')
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
        '/connect/team/request/flood-risk-team/deployment-1'
      )
    })

    test.each([
      [
        'model-not-eligible',
        'One of these models is not available for your team.'
      ],
      [
        'model-not-granted',
        'Your team does not have access to one of these models.'
      ],
      ['environment-not-available', 'This environment is not available yet.'],
      ['something-new', 'The backend said so']
    ])('words the backend code %s in plain English', async (code, message) => {
      const cookies = await reachCheckStep(server, await signIn(server))

      mockResponse(
        {
          statusCode: 422,
          error: 'Unprocessable',
          message: 'The backend said so',
          code
        },
        { status: 422 }
      )
      mockResponse(sampleModel)

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/check',
        {}
      )

      expect(statusCode).toBe(422)
      expect(result).toContain(message)
      expect(result).not.toContain('View the existing request')
    })

    test('says so, on the check page, when the backend cannot be reached', async () => {
      const cookies = await reachCheckStep(server, await signIn(server))
      fetchMock.mockRejectOnce(new Error('boom'))
      mockResponse(sampleModel)

      const { statusCode, result } = await post(
        server,
        cookies,
        '/connect/team/check',
        {}
      )

      expect(statusCode).toBe(502)
      expect(result).toContain('There is a problem')
      expect(result).toContain('Check your answers')
    })

    test('sends a journey that is not finished back to the start', async () => {
      const cookies = await reachDetails(server, await signIn(server))

      const checkPage = await get(server, cookies, '/connect/team/check')
      const confirm = await post(server, cookies, '/connect/team/check', {})

      expect(checkPage.headers.location).toBe('/models')
      expect(confirm.headers.location).toBe('/models')
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

      expect(checkAgain.headers.location).toBe('/models')
      expect(modelAgain.headers.location).toBe('/models')
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

      expect(details.headers.location).toBe('/models')
      expect(model.headers.location).toBe('/models')
    })
  })
})

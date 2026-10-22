import createFetchMock from 'vitest-fetch-mock'

import { config } from '#/config/config.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
  nanoModel,
  sampleModel,
  sampleTeam,
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

const TEAM_PATH = `/v1/teams/${sampleTeam.slug}`
const TEST_URL = `/teams/${sampleTeam.slug}/test`
const TEST_MODELS_PATH = '/v1/models?tier=team&environment=qa'

const cohereModel = {
  ...sampleModel,
  slug: 'cohere-command',
  displayName: 'Cohere Command',
  useCases: ['Search']
}

function deployment(overrides = {}) {
  return {
    _id: 'deployment-1',
    teamId: 'team-1',
    modelSlug: 'gpt-4o',
    environment: 'infradev',
    status: 'active',
    ...overrides
  }
}

describe('#environmentSetUpController', () => {
  let server
  let cookies
  const configured = config.get('teamEnvironments')

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('teamEnvironments', configured)
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    config.set('teamEnvironments', ['infradev', 'qa'])
    fetchMock.resetMocks()
    cookies = await signInViaOidc(server, fetchMock)
  })

  // Ready in Development: GPT-4o and GPT-4.1 nano (and Cohere, which Test
  // cannot run). Test already has nothing.
  function backend({ role = 'admin', ...routes } = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: { ...teamWithMembers(role), environments: [] },
      [`GET ${TEAM_PATH}/deployments`]: {
        items: [
          deployment(),
          deployment({ _id: 'deployment-2', modelSlug: 'gpt-4-1-nano' }),
          deployment({ _id: 'deployment-3', modelSlug: 'cohere-command' })
        ]
      },
      [`GET ${TEST_MODELS_PATH}`]: { items: [sampleModel, nanoModel] },
      'GET /v1/models': {
        items: [sampleModel, nanoModel, cohereModel]
      },
      ...routes
    })
  }

  function get(url, jar = cookies) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(jar) }
    })
  }

  function post(payload, url = TEST_URL, jar = cookies) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(jar) },
      payload: { crumb: jar.crumb, ...payload }
    })
  }

  describe.each([
    ['a team admin', 'admin'],
    ['a team member', 'user']
  ])('for %s', (_who, role) => {
    test('asks which models they want in Test, with every ready model ticked', async () => {
      backend({ role })

      const { statusCode, result } = await get(TEST_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(
        /govuk-caption-xl[^>]*>Flood Risk Team<\/span>[\s\S]*Which models do you want in Test\?/
      )
      expect(result).toContain(
        'These are the models your team has in Development.'
      )
      expect(result).toMatch(/value="gpt-4o"[^>]*checked/)
      expect(result).toMatch(/value="gpt-4-1-nano"[^>]*checked/)
      expect(result.match(/Ready in Development/g)).toHaveLength(2)
    })

    test('leaves out a model Test cannot run, and one that is not ready yet', async () => {
      backend({
        role,
        [`GET ${TEAM_PATH}/deployments`]: {
          items: [
            deployment(),
            deployment({
              _id: 'deployment-2',
              modelSlug: 'gpt-4-1-nano',
              status: 'deploying'
            }),
            deployment({ _id: 'deployment-3', modelSlug: 'cohere-command' }),
            deployment({
              _id: 'deployment-4',
              modelSlug: 'gpt-4-1-nano',
              status: 'checks-failed'
            })
          ]
        }
      })

      const { result } = await get(TEST_URL)

      expect(result).toContain('value="gpt-4o"')
      expect(result).not.toContain('value="gpt-4-1-nano"')
      expect(result).not.toContain('value="cohere-command"')
    })

    test('leaves out a model the team already has in Test, unless it was removed', async () => {
      backend({
        role,
        [`GET ${TEAM_PATH}/deployments`]: {
          items: [
            deployment(),
            deployment({ _id: 'deployment-2', modelSlug: 'gpt-4-1-nano' }),
            deployment({
              _id: 'deployment-5',
              modelSlug: 'gpt-4o',
              environment: 'qa',
              status: 'deploying'
            }),
            deployment({
              _id: 'deployment-6',
              modelSlug: 'gpt-4-1-nano',
              environment: 'qa',
              status: 'removed'
            })
          ]
        }
      })

      const { result } = await get(TEST_URL)

      expect(result).not.toContain('value="gpt-4o"')
      expect(result).toContain('value="gpt-4-1-nano"')
    })

    test('says what happens next and has a Continue button', async () => {
      backend({ role })

      const { result } = await get(TEST_URL)

      expect(result).toContain('What happens next')
      expect(result).toContain('When you continue:')
      expect(result).toContain(
        'we set up a separate deployment of each model in Test'
      )
      expect(result).toContain(
        'your team gets a separate client secret for Test'
      )
      expect(result).toContain(
        'Test starts with the same limits as Development'
      )
      expect(result).toMatch(/<button[^>]*>\s*Continue\s*<\/button>/)
      expect(result).toMatch(/href="\/teams\/flood-risk-team"[^>]*>\s*Back/)
    })

    test('says so, with no button, when there is nothing to set up', async () => {
      backend({
        role,
        [`GET ${TEAM_PATH}/deployments`]: { items: [] }
      })

      const { statusCode, result } = await get(TEST_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('There are no models to set up in Test.')
      expect(result).not.toMatch(/<button[^>]*>\s*Continue/)
    })
  })

  describe('for a person who is only signed in with their own keys', () => {
    test('is told the team is not found, and nothing about its models is read', async () => {
      backend({
        [`GET ${TEAM_PATH}`]: reply(403, { code: 'forbidden', message: 'No' })
      })

      const { statusCode, result } = await get(TEST_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Team not found')
      expect(
        fetchMock.mock.calls.map(
          ([request]) => new URL(request.url ?? request).pathname
        )
      ).not.toContain(`${TEAM_PATH}/deployments`)
    })

    test('is told the same when the team is not theirs and does not exist', async () => {
      backend({ [`GET ${TEAM_PATH}`]: reply(404, { code: 'not-found' }) })

      const { statusCode } = await get(TEST_URL)

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('cannot post a choice either', async () => {
      backend({ [`GET ${TEAM_PATH}`]: reply(404, { code: 'not-found' }) })

      const { statusCode } = await post({ modelSlugs: 'gpt-4o' })

      expect(statusCode).toBe(statusCodes.notFound)
    })
  })

  describe('which environments it answers for', () => {
    test.each([
      ['preprod', 'pre-production'],
      ['prod', 'production']
    ])(
      'returns 404 for %s, which is not in the teams environments',
      async (_code, name) => {
        backend()

        const { statusCode, result } = await get(
          `/teams/${sampleTeam.slug}/${name}`
        )

        expect(statusCode).toBe(statusCodes.notFound)
        expect(result).toContain('This environment is not available yet.')
      }
    )

    test('returns 404 for a name that is not an environment', async () => {
      backend()

      const { statusCode } = await get(`/teams/${sampleTeam.slug}/nowhere`)

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('returns 404 for Test itself when Test is not configured', async () => {
      config.set('teamEnvironments', ['infradev'])
      backend()

      const { statusCode } = await get(TEST_URL)

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('answers for any available environment by its lower-case name', async () => {
      config.set('teamEnvironments', ['infradev', 'qa', 'preprod'])
      backend({
        'GET /v1/models?tier=team&environment=preprod': { items: [sampleModel] }
      })

      const { statusCode, result } = await get(
        `/teams/${sampleTeam.slug}/pre-production`
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Which models do you want in Pre-production?')
      expect(result).toContain(
        'Pre-production starts with the same limits as Development'
      )
    })

    test('sends the first environment to the request journey, which is where a team starts', async () => {
      backend()

      const response = await get(`/teams/${sampleTeam.slug}/development`)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe('/connect/team/start')
    })
  })

  describe('choosing models', () => {
    test('asks for at least one model', async () => {
      backend()

      const { statusCode, result } = await post({})

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('There is a problem')
      expect(result).toContain('Select at least one model')
      expect(result).toMatch(
        /<title>[^<]*Error: Which models do you want in Test\?/
      )
    })

    test('refuses a model that was not offered', async () => {
      backend()

      const { statusCode, result } = await post({
        modelSlugs: ['gpt-4o', 'cohere-command']
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Select models from the list')
      expect(result).toMatch(/value="gpt-4o"[^>]*checked/)
    })

    test('hands the choice to the check page for Test, with nothing sent yet', async () => {
      backend()

      const response = await post({ modelSlugs: ['gpt-4o', 'gpt-4-1-nano'] })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe('/connect/team/check')
      expect(
        fetchMock.mock.calls.some(
          ([request]) =>
            request.method === 'POST' &&
            String(request.url).includes('/deployments')
        )
      ).toBe(false)
    })

    test('accepts one ticked model, which posts as a string', async () => {
      backend()

      const response = await post({ modelSlugs: 'gpt-4o' })

      expect(response.statusCode).toBe(statusCodes.seeOther)
    })
  })

  describe('coming back from the check page', () => {
    async function toCheck(payload) {
      const chosen = await post(payload)

      return mergeCookies(cookies, chosen)
    }

    test('keeps what was ticked, so Back and Continue add only those', async () => {
      backend()

      const jar = await toCheck({ modelSlugs: 'gpt-4o' })
      const { result } = await get(TEST_URL, jar)

      expect(result).toMatch(/value="gpt-4o"[^>]*checked/)
      expect(result).toContain('value="gpt-4-1-nano"')
      expect(result).not.toMatch(/value="gpt-4-1-nano"[^>]*checked/)
    })

    test('keeps the purpose entered on the check page', async () => {
      backend({ 'GET /v1/models/gpt-4o': sampleModel })

      let jar = await toCheck({ modelSlugs: 'gpt-4o' })
      const saved = await server.inject({
        method: 'POST',
        url: '/connect/team/details?change=check',
        headers: { cookie: cookieHeader(jar) },
        payload: { crumb: jar.crumb, purpose: 'Testing flood alerts' }
      })

      jar = mergeCookies(jar, saved)

      const again = await post({ modelSlugs: 'gpt-4o' }, TEST_URL, jar)
      const check = await get('/connect/team/check', mergeCookies(jar, again))

      expect(check.result).toContain('Testing flood alerts')
    })

    test('starts with every model ticked and no purpose for a journey for another team or environment', async () => {
      backend()

      const jar = await toCheck({ modelSlugs: 'gpt-4o' })

      config.set('teamEnvironments', ['infradev', 'qa', 'preprod'])
      backend({
        'GET /v1/models?tier=team&environment=preprod': {
          items: [sampleModel, nanoModel]
        }
      })

      const { result } = await get(
        `/teams/${sampleTeam.slug}/pre-production`,
        jar
      )

      expect(result).toMatch(/value="gpt-4-1-nano"[^>]*checked/)
    })

    test('offers only what is ready in Development when the models are changed from the check page', async () => {
      backend({
        [`GET ${TEST_MODELS_PATH}`]: {
          items: [sampleModel, nanoModel, cohereModel]
        },
        [`GET ${TEAM_PATH}/deployments`]: {
          items: [
            deployment(),
            deployment({
              _id: 'deployment-2',
              modelSlug: 'gpt-4-1-nano',
              status: 'deploying'
            })
          ]
        }
      })

      const jar = await toCheck({ modelSlugs: 'gpt-4o' })
      const { result } = await get('/connect/team/model?change=check', jar)

      expect(result).toContain('value="gpt-4o"')
      expect(result).not.toContain('value="gpt-4-1-nano"')
      expect(result).not.toContain('value="cohere-command"')
    })

    test('refuses a model that is not ready in Development when it is posted from the change page', async () => {
      backend({
        [`GET ${TEST_MODELS_PATH}`]: { items: [sampleModel, nanoModel] },
        [`GET ${TEAM_PATH}/deployments`]: { items: [deployment()] }
      })

      const jar = await toCheck({ modelSlugs: 'gpt-4o' })
      const { statusCode, result } = await server.inject({
        method: 'POST',
        url: '/connect/team/model?change=check',
        headers: { cookie: cookieHeader(jar) },
        payload: { crumb: jar.crumb, modelSlugs: ['gpt-4-1-nano'] }
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Select models from the list')
    })
  })
  describe('from the check page to the models being set up in Test', () => {
    test('checks the answers for Test, requests them for qa, then follows the set-up in Test', async () => {
      let requested
      backend({
        [`POST ${TEAM_PATH}/deployments`]: async (request) => {
          requested = await request.json()

          return {
            deployments: [
              deployment({
                _id: 'deployment-9',
                environment: 'qa',
                status: 'requested'
              })
            ]
          }
        },
        'GET /v1/models/gpt-4o': sampleModel,
        'GET /v1/models?includeIneligible=true': { items: [sampleModel] }
      })

      const chosen = await post({ modelSlugs: 'gpt-4o' })
      const jar = mergeCookies(cookies, chosen)
      const check = await get('/connect/team/check', jar)

      expect(check.statusCode).toBe(statusCodes.ok)
      expect(check.result).toMatch(
        /Environment\s*<\/dt>\s*<dd[^>]*>\s*Test\s*<\/dd>/
      )
      expect(check.result).toContain('Flood Risk Team')
      expect(check.result).toContain('GPT-4o')
      expect(check.result).toMatch(
        /href="\/teams\/flood-risk-team\/test"[^>]*>\s*Back/
      )

      const confirmed = await server.inject({
        method: 'POST',
        url: '/connect/team/check',
        headers: { cookie: cookieHeader(jar) },
        payload: { crumb: jar.crumb }
      })

      expect(confirmed.statusCode).toBe(statusCodes.seeOther)
      expect(requested).toEqual({ modelSlugs: ['gpt-4o'], environment: 'qa' })
      expect(confirmed.headers.location).toBe(
        '/connect/team/request/flood-risk-team/deployment-9'
      )

      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: { ...teamWithMembers('admin'), environments: [] },
        [`GET ${TEAM_PATH}/deployments`]: {
          items: [
            deployment({
              _id: 'deployment-9',
              environment: 'qa',
              status: 'deploying'
            })
          ]
        },
        'GET /v1/models?includeIneligible=true': { items: [sampleModel] }
      })

      const waiting = await get(
        confirmed.headers.location,
        mergeCookies(jar, confirmed)
      )

      expect(waiting.statusCode).toBe(statusCodes.ok)
      expect(waiting.result).toContain('Setting up GPT-4o in Test')
    })

    test('keeps Test when what it is for is changed from the check page', async () => {
      backend({ 'GET /v1/models/gpt-4o': sampleModel })

      const chosen = await post({ modelSlugs: 'gpt-4o' })
      const jar = mergeCookies(cookies, chosen)
      const details = await get('/connect/team/details?change=check', jar)

      expect(details.result).toContain('It will be set up in Test.')

      const saved = await server.inject({
        method: 'POST',
        url: '/connect/team/details?change=check',
        headers: { cookie: cookieHeader(jar) },
        payload: { crumb: jar.crumb, purpose: 'Testing flood alerts' }
      })

      expect(saved.headers.location).toBe('/connect/team/check')

      const check = await get('/connect/team/check', mergeCookies(jar, saved))

      expect(check.result).toMatch(
        /Environment\s*<\/dt>\s*<dd[^>]*>\s*Test\s*<\/dd>/
      )
      expect(check.result).toContain('Testing flood alerts')
    })
  })
})

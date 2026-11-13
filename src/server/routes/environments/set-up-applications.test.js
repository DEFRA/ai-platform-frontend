import { load } from 'cheerio'
import { randomUUID } from 'node:crypto'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import { FEDERATIONS_PATH, queued } from '#/test-helpers/federation-helpers.js'
import {
  TEAM_PATH,
  applicationsOf,
  detail,
  federatedApplication
} from '#/test-helpers/environments-helpers.js'
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

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal()

  return { ...actual, randomUUID: vi.fn(() => actual.randomUUID()) }
})

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

const SET_UP_URL = `/environments/${sampleTeam.slug}/qa/set-up`
const APPLICATIONS_URL = `${SET_UP_URL}/applications`
const CHECK_URL = '/connect/team/check'
const TEST_MODELS_PATH = '/v1/models?tier=team&environment=qa'
const INFRADEV_PATH = `${TEAM_PATH}/environments/infradev`
const QA_PATH = `${TEAM_PATH}/environments/qa`

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

const floodApi = federatedApplication({
  name: 'flood-api',
  service: 'flood-api'
})
const floodWorker = federatedApplication({
  id: 'app-2',
  name: 'flood-worker',
  service: 'flood-worker',
  status: 'setting-up'
})
const floodReports = federatedApplication({
  id: 'app-3',
  name: 'flood-reports',
  host: 'azure',
  service: undefined,
  principalId: '11111111-1111-4111-8111-111111111111'
})
const oldService = federatedApplication({
  id: 'app-4',
  name: 'flood-old',
  service: 'flood-old',
  status: 'removing'
})

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('the CDP services offered when another environment is set up (choice B)', () => {
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

  // Infradev holds three CDP services and an Azure application; QA already
  // holds one of the CDP services.
  function backend({ role = 'admin', infradev, qa, ...routes } = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: { ...teamWithMembers(role), environments: [] },
      [`GET ${TEAM_PATH}/deployments`]: {
        items: [deployment(), deployment({ _id: 'deployment-2' })]
      },
      [`GET ${TEST_MODELS_PATH}`]: { items: [sampleModel, nanoModel] },
      'GET /v1/models': { items: [sampleModel, nanoModel] },
      'GET /v1/models/gpt-4o': sampleModel,
      [`GET ${INFRADEV_PATH}`]: detail({
        applications: applicationsOf(
          infradev ?? [floodApi, floodWorker, floodReports, oldService]
        )
      }),
      [`GET ${QA_PATH}`]: detail({
        environment: 'qa',
        applications: applicationsOf(
          qa ?? [
            federatedApplication({
              service: 'flood-worker',
              name: 'flood-worker'
            })
          ]
        )
      }),
      ...routes
    })
  }

  async function send(method, url, payload) {
    const response = await server.inject({
      method,
      url,
      headers: { cookie: cookieHeader(cookies) },
      ...(payload && { payload: { crumb: cookies.crumb, ...payload } })
    })

    cookies = mergeCookies(cookies, response)

    return { response, $: load(response.result ?? '') }
  }

  function calls(method, path) {
    return fetchMock.mock.calls.filter(
      ([url, init]) => init?.method === method && new URL(url).pathname === path
    )
  }

  const chooseModels = () => send('POST', SET_UP_URL, { modelSlugs: 'gpt-4o' })

  test('asks which CDP services next, after the models, when the first environment has some the new one does not', async () => {
    backend()

    const chosen = await chooseModels()

    expect(chosen.response.statusCode).toBe(statusCodes.seeOther)
    expect(chosen.response.headers.location).toBe(APPLICATIONS_URL)
  })

  test('lists the CDP services federated in the first environment that the new one does not hold, each ticked, and never an Azure application or a service being removed (AC26)', async () => {
    backend()
    await chooseModels()

    const { response, $ } = await send('GET', APPLICATIONS_URL)

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(text($, 'legend h1')).toBe(
      'Which CDP services should be federated in Test?'
    )
    expect(
      $('input[name="services"]')
        .map((_, el) => $(el).val())
        .get()
    ).toEqual(['flood-api'])
    expect($('input[name="services"][checked]')).toHaveLength(1)
    expect(text($, '#services-hint')).toBe(
      'These are the CDP services your team federated in Development. Each one is added to Test once your models are set up.'
    )
    expect($('a.govuk-back-link').attr('href')).toBe(SET_UP_URL)
    expect(text($, '[data-testid="app-heading-caption"]')).toBe(
      'Flood Risk Team'
    )
  })

  test('keeps the services chosen, and their keys, when the models are chosen again from Back', async () => {
    backend({
      infradev: [floodApi, floodWorker],
      qa: [],
      [`POST ${TEAM_PATH}/deployments`]: reply(202, {
        deployments: [{ _id: 'deployment-9' }]
      }),
      [`POST ${FEDERATIONS_PATH}`]: queued()
    })
    await chooseModels()

    const issuedBefore = randomUUID.mock.results.length

    await send('POST', APPLICATIONS_URL, { services: ['flood-worker'] })

    const workerKey = randomUUID.mock.results[issuedBefore].value
    const again = await chooseModels()
    const { $ } = await send('GET', APPLICATIONS_URL)

    expect(again.response.headers.location).toBe(APPLICATIONS_URL)
    expect(
      $('input[name="services"][checked]')
        .map((_, el) => $(el).val())
        .get()
    ).toEqual(['flood-worker'])

    await send('POST', APPLICATIONS_URL, { services: ['flood-worker'] })
    await send('POST', CHECK_URL, {})

    expect(
      calls('POST', FEDERATIONS_PATH).map(([, init]) => [
        JSON.parse(init.body).service,
        init.headers['idempotency-key']
      ])
    ).toEqual([['flood-worker', workerKey]])
  })

  test('keeps the answer of no services when the models are chosen again', async () => {
    backend({ infradev: [floodApi, floodWorker], qa: [] })
    await chooseModels()
    await send('POST', APPLICATIONS_URL, {})
    await chooseModels()

    const { $ } = await send('GET', APPLICATIONS_URL)

    expect($('input[name="services"][checked]')).toHaveLength(0)
  })

  test('drops a chosen service that is no longer offered when the models are chosen again', async () => {
    backend({ infradev: [floodApi, floodWorker], qa: [] })
    await chooseModels()
    await send('POST', APPLICATIONS_URL, {
      services: ['flood-api', 'flood-worker']
    })
    backend({ infradev: [floodApi], qa: [] })
    await chooseModels()

    const { $ } = await send('GET', APPLICATIONS_URL)

    expect(
      $('input[name="services"][checked]')
        .map((_, el) => $(el).val())
        .get()
    ).toEqual(['flood-api'])
  })

  test('asks again, with every service ticked, when the models are chosen for another environment or team', async () => {
    backend({ infradev: [floodApi, floodWorker], qa: [] })
    await chooseModels()
    await send('POST', APPLICATIONS_URL, { services: ['flood-worker'] })
    config.set('teamEnvironments', ['infradev', 'qa', 'preprod'])
    backend({
      infradev: [floodApi, floodWorker],
      qa: [],
      'GET /v1/models?tier=team&environment=preprod': {
        items: [sampleModel, nanoModel]
      },
      [`GET ${TEAM_PATH}/environments/preprod`]: detail({
        environment: 'preprod',
        applications: applicationsOf([])
      })
    })

    await send('POST', `/environments/${sampleTeam.slug}/preprod/set-up`, {
      modelSlugs: 'gpt-4o'
    })
    const { $ } = await send(
      'GET',
      `/environments/${sampleTeam.slug}/preprod/set-up/applications`
    )

    expect($('input[name="services"][checked]')).toHaveLength(2)
  })

  test('cannot be checked before the services question is answered', async () => {
    backend({
      infradev: [floodApi],
      qa: [],
      [`POST ${TEAM_PATH}/deployments`]: reply(202, {
        deployments: [{ _id: 'deployment-9' }]
      })
    })
    await chooseModels()

    const get = await send('GET', CHECK_URL)
    const post = await send('POST', CHECK_URL, {})

    expect(get.response.statusCode).toBe(statusCodes.seeOther)
    expect(get.response.headers.location).toBe(APPLICATIONS_URL)
    expect(post.response.statusCode).toBe(statusCodes.seeOther)
    expect(post.response.headers.location).toBe(APPLICATIONS_URL)
    expect(calls('POST', `${TEAM_PATH}/deployments`)).toHaveLength(0)
  })

  test('can be checked once the question was answered with no services', async () => {
    backend({ infradev: [floodApi], qa: [] })
    await chooseModels()
    await send('POST', APPLICATIONS_URL, {})

    const { response } = await send('GET', CHECK_URL)

    expect(response.statusCode).toBe(statusCodes.ok)
  })

  test('offers every service of the first environment when the new one cannot be read yet', async () => {
    backend({ [`GET ${QA_PATH}`]: reply(404, { code: 'error' }) })
    await chooseModels()

    const { $ } = await send('GET', APPLICATIONS_URL)

    expect(
      $('input[name="services"]')
        .map((_, el) => $(el).val())
        .get()
    ).toEqual(['flood-api', 'flood-worker'])
  })

  test('keeps a service’s key while it stays chosen, so confirming again is the same request', async () => {
    backend({
      infradev: [floodApi, floodWorker],
      qa: [],
      [`POST ${TEAM_PATH}/deployments`]: reply(202, {
        deployments: [{ _id: 'deployment-9' }]
      }),
      [`POST ${FEDERATIONS_PATH}`]: queued()
    })
    await chooseModels()
    await send('POST', APPLICATIONS_URL, { services: ['flood-api'] })
    await send('POST', APPLICATIONS_URL, {
      services: ['flood-api', 'flood-worker']
    })
    await send('POST', CHECK_URL, {})
    const keys = Object.fromEntries(
      calls('POST', FEDERATIONS_PATH).map(([, init]) => [
        JSON.parse(init.body).service,
        init.headers['idempotency-key']
      ])
    )

    expect(Object.keys(keys)).toEqual(['flood-api', 'flood-worker'])
    expect(keys['flood-api']).not.toBe(keys['flood-worker'])
  })

  test('offers a service that is still being set up, which the team chose', async () => {
    backend({ infradev: [floodWorker], qa: [] })
    await chooseModels()

    const { $ } = await send('GET', APPLICATIONS_URL)

    expect($('input[name="services"]').val()).toBe('flood-worker')
  })

  test('goes straight to the check when there is nothing to offer, and the check says nothing about services', async () => {
    backend({ infradev: [floodReports], qa: [] })

    const chosen = await chooseModels()
    const check = await send('GET', CHECK_URL)

    expect(chosen.response.headers.location).toBe(CHECK_URL)
    expect(text(check.$, '.govuk-summary-list')).not.toContain(
      'CDP services to federate'
    )
    expect(check.$('a.govuk-back-link').attr('href')).toBe(SET_UP_URL)
  })

  test('still sets up the environment when the first environment cannot be read', async () => {
    backend({
      [`GET ${INFRADEV_PATH}`]: reply(502, { code: 'upstream-unavailable' })
    })

    const chosen = await chooseModels()

    expect(chosen.response.headers.location).toBe(CHECK_URL)
  })

  test('goes on to the check with what was ticked, which lists it with Change, and goes back to the question', async () => {
    backend()
    await chooseModels()

    const saved = await send('POST', APPLICATIONS_URL, {
      services: ['flood-api']
    })
    const check = await send('GET', CHECK_URL)
    const row = check.$('.govuk-summary-list__row').last()

    expect(saved.response.headers.location).toBe(CHECK_URL)
    expect(text(check.$, row.find('dt'))).toBe('CDP services to federate')
    expect(text(check.$, row.find('dd').first())).toBe('flood-api')
    expect(row.find('a').attr('href')).toBe(APPLICATIONS_URL)
    expect(check.$('a.govuk-back-link').attr('href')).toBe(APPLICATIONS_URL)
  })

  test('says None on the check when no service was ticked', async () => {
    backend()
    await chooseModels()

    await send('POST', APPLICATIONS_URL, {})
    const check = await send('GET', CHECK_URL)

    expect(
      text(
        check.$,
        check.$('.govuk-summary-list__row').last().find('dd').first()
      )
    ).toBe('None')
  })

  test('keeps what was ticked when asked again', async () => {
    backend({ infradev: [floodApi, floodWorker], qa: [] })
    await chooseModels()
    await send('POST', APPLICATIONS_URL, { services: ['flood-worker'] })

    const { $ } = await send('GET', APPLICATIONS_URL)

    expect(
      $('input[name="services"][checked]')
        .map((_, el) => $(el).val())
        .get()
    ).toEqual(['flood-worker'])
  })

  test.each([
    ['a service the page did not offer', { services: ['other-service'] }],
    ['a name that is not a service', { services: ['Not A Service'] }]
  ])('refuses %s', async (_name, payload) => {
    backend()
    await chooseModels()

    const { response, $ } = await send('POST', APPLICATIONS_URL, payload)

    expect(response.statusCode).toBe(statusCodes.badRequest)
    expect($('title').text()).toContain('Error:')
    expect(text($, '.govuk-error-summary')).toContain(
      'Select CDP services from the list'
    )
    expect($('.govuk-error-summary a').attr('href')).toBe('#services')
  })

  test('refuses the same service twice', async () => {
    backend()
    await chooseModels()

    const { response } = await send('POST', APPLICATIONS_URL, {
      services: ['flood-api', 'flood-api']
    })

    expect(response.statusCode).toBe(statusCodes.badRequest)
  })

  test('sends a person with no set-up under way back to it', async () => {
    backend()

    const get = await send('GET', APPLICATIONS_URL)
    const post = await send('POST', APPLICATIONS_URL, {})

    expect(get.response.headers.location).toBe(SET_UP_URL)
    expect(post.response.headers.location).toBe(SET_UP_URL)
  })

  test('is a 404 for an environment this instance does not offer, and for a person who is not a member', async () => {
    backend()

    const prod = await send(
      'GET',
      `/environments/${sampleTeam.slug}/prod/set-up/applications`
    )

    expect(prod.response.statusCode).toBe(statusCodes.notFound)

    backend({
      [`GET ${TEAM_PATH}`]: reply(404, { code: 'error', message: 'Not found' })
    })

    expect((await send('GET', APPLICATIONS_URL)).response.statusCode).toBe(
      statusCodes.notFound
    )
  })

  test('carries on to the check when the services have gone since they were offered', async () => {
    backend()
    await chooseModels()
    backend({ infradev: [floodReports], qa: [] })

    const { response } = await send('GET', APPLICATIONS_URL)
    const check = await send('GET', CHECK_URL)

    expect(response.headers.location).toBe(CHECK_URL)
    expect(text(check.$, '.govuk-summary-list')).not.toContain(
      'CDP services to federate'
    )
  })

  describe('confirming the request', () => {
    const REQUEST_URL = `/connect/team/request/${sampleTeam.slug}/deployment-9`

    function requestRoutes(extra = {}) {
      return {
        [`POST ${TEAM_PATH}/deployments`]: reply(202, {
          deployments: [{ _id: 'deployment-9' }]
        }),
        [`GET ${TEAM_PATH}/deployments`]: {
          items: [
            deployment(),
            deployment({ _id: 'deployment-2', modelSlug: 'gpt-4-1-nano' }),
            // The request just made: its model is not one the set-up offers.
            deployment({
              _id: 'deployment-9',
              modelSlug: 'gpt-4-1-nano',
              environment: 'qa',
              status: 'applying'
            })
          ]
        },
        [`POST ${FEDERATIONS_PATH}`]: queued(),
        ...extra
      }
    }

    async function confirm(services, routes = {}) {
      backend(requestRoutes(routes))
      await chooseModels()
      await send('POST', APPLICATIONS_URL, { services })

      return send('POST', CHECK_URL, {})
    }

    async function confirmed(services, routes = {}) {
      const made = await confirm(services, routes)

      return { confirm: made, page: await send('GET', REQUEST_URL) }
    }

    test('asks for each service to be federated in the new environment after the request, one request each, with a key of its own (AC26)', async () => {
      const { confirm } = await confirmed(['flood-api', 'flood-worker'], {
        [`GET ${INFRADEV_PATH}`]: detail({
          applications: applicationsOf([floodApi, floodWorker])
        }),
        [`GET ${QA_PATH}`]: detail({ applications: applicationsOf([]) })
      })
      const federations = calls('POST', FEDERATIONS_PATH)
      const [deploymentCall] = calls('POST', `${TEAM_PATH}/deployments`)

      expect(confirm.response.headers.location).toBe(REQUEST_URL)
      expect(federations).toHaveLength(2)
      expect(federations.map(([, init]) => JSON.parse(init.body))).toEqual([
        { host: 'cdp', service: 'flood-api', environments: ['qa'] },
        { host: 'cdp', service: 'flood-worker', environments: ['qa'] }
      ])
      const keys = federations.map(
        ([, init]) => init.headers['idempotency-key']
      )

      expect(new Set(keys).size).toBe(2)
      expect(keys.every((key) => /^[0-9a-f-]{36}$/.test(key))).toBe(true)
      // After the deployment request, so the file's changes run in order.
      expect(fetchMock.mock.calls.indexOf(deploymentCall)).toBeLessThan(
        fetchMock.mock.calls.indexOf(federations[0])
      )
    })

    test('says on the page that follows that they will be federated, once', async () => {
      const { page } = await confirmed(['flood-api'])
      const again = await send('GET', REQUEST_URL)

      expect(text(page.$, '[data-testid="team-notification"]')).toContain(
        'flood-api will be federated in QA'
      )
      expect(again.$('[data-testid="team-notification"]')).toHaveLength(0)
    })

    test('says it on the failed page when the request failed before the first visit, once', async () => {
      const failedDeployment = deployment({
        _id: 'deployment-9',
        modelSlug: 'gpt-4-1-nano',
        environment: 'qa',
        status: 'deploy-failed'
      })
      await confirm(['flood-api'])
      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: { ...teamWithMembers('admin'), environments: [] },
        [`GET ${TEAM_PATH}/deployments`]: { items: [failedDeployment] },
        'GET /v1/models?includeIneligible=true': { items: [nanoModel] }
      })

      const page = await send('GET', REQUEST_URL)
      const again = await send('GET', REQUEST_URL)

      expect(text(page.$, 'h1')).toContain('We could not set up')
      expect(text(page.$, '[data-testid="team-notification"]')).toContain(
        'flood-api will be federated in QA'
      )
      expect(again.$('[data-testid="team-notification"]')).toHaveLength(0)
    })

    test('does not show it on another page before the request page is visited', async () => {
      await confirm(['flood-api'])
      mockApi(fetchMock, { 'GET /v1/teams': { items: [sampleTeam] } })

      const teams = await send('GET', '/teams')

      expect(teams.response.statusCode).toBe(statusCodes.ok)
      expect(teams.response.result).not.toContain('will be federated')
    })

    test('does not show it on the page of another request', async () => {
      await confirm(['flood-api'])
      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: { ...teamWithMembers('admin'), environments: [] },
        [`GET ${TEAM_PATH}/deployments`]: {
          items: [
            deployment({
              _id: 'deployment-8',
              environment: 'qa',
              status: 'applying'
            })
          ]
        },
        'GET /v1/models?includeIneligible=true': { items: [sampleModel] }
      })

      const other = await send(
        'GET',
        `/connect/team/request/${sampleTeam.slug}/deployment-8`
      )

      expect(other.$('[data-testid="team-notification"]')).toHaveLength(0)
    })

    test('makes no federation request when none was ticked', async () => {
      const { confirm, page } = await confirmed([])

      expect(confirm.response.headers.location).toBe(REQUEST_URL)
      expect(calls('POST', FEDERATIONS_PATH)).toHaveLength(0)
      expect(page.$('[data-testid="team-notification"]')).toHaveLength(0)
    })

    test('says why a service could not be added yet, and the models are still requested, until the environment is set up', async () => {
      const { confirm, page } = await confirmed(['flood-api'], {
        [`POST ${FEDERATIONS_PATH}`]: reply(409, {
          code: 'federation-refused',
          message: 'Refused',
          environments: [{ environment: 'qa', code: 'environment-not-set-up' }]
        })
      })

      expect(confirm.response.headers.location).toBe(REQUEST_URL)
      expect(text(page.$, '[data-testid="team-notification"]')).toContain(
        'We could not add every CDP service to QA'
      )
      expect(text(page.$, '[data-testid="team-notification"]')).toContain(
        'flood-api cannot be added until QA is set up. Federate it from the QA page once your models are ready.'
      )
    })

    test('names the environment for any other refusal, never another team', async () => {
      const { page } = await confirmed(['flood-api'], {
        [`POST ${FEDERATIONS_PATH}`]: reply(409, {
          code: 'federation-refused',
          message: 'Refused',
          environments: [
            { environment: 'qa', code: 'federation-trusted-elsewhere' }
          ]
        })
      })

      expect(text(page.$, '[data-testid="team-notification"]')).toContain(
        'QA: another team already uses flood-api there.'
      )
    })

    test('says so for a failure of the backend, without undoing the request', async () => {
      const { confirm, page } = await confirmed(['flood-api'], {
        [`POST ${FEDERATIONS_PATH}`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      expect(confirm.response.statusCode).toBe(statusCodes.seeOther)
      expect(text(page.$, '[data-testid="team-notification"]')).toContain(
        'We could not add every CDP service to QA'
      )
    })
  })
})

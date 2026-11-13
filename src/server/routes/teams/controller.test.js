import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  environmentsRead,
  summary
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

const TEAM_PATH = `/v1/teams/${sampleTeam.slug}`
const ENVIRONMENTS_PATH = `${TEAM_PATH}/environments`
const TEAM_URL = `/teams/${sampleTeam.slug}`
const NOT_FOUND = reply(404, { code: 'not-found', message: 'Not Found' })

const catalogue = [sampleModel, nanoModel]

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

describe('#teamsController', () => {
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

  function get(url, headers = {}) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies), ...headers }
    })
  }

  function post(url, payload = {}) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, ...payload }
    })
  }

  describe('the teams list', () => {
    test('GET /teams redirects to /sign-in when signed out', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/teams'
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/sign-in?returnTo=%2Fteams')
    })

    test('for a person with only their own keys: says they have no team and offers to create one', async () => {
      mockApi(fetchMock, { 'GET /v1/teams': { items: [] } })

      const { statusCode, result } = await get('/teams')

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('<h1 class="govuk-heading-xl')
      expect(result).toContain('>Teams<')
      expect(result).toContain(
        'A team shares its models, and has one client secret for each environment.'
      )
      expect(result).toMatch(
        /<a href="\/teams\/new"[^>]*>\s*Create a team\s*<\/a>/
      )
      expect(result).toContain('You are not a member of a team yet')
      expect(result).not.toContain('data-testid="teams-table"')
      expect(
        fetchMock.mock.calls.filter(([url]) => url.includes('/deployments'))
      ).toHaveLength(0)
    })

    test('for an admin and a member: a row for each team with the role, member count and models', async () => {
      const coastal = {
        _id: 'team-2',
        slug: 'coastal-team',
        name: 'Coastal Team',
        role: 'user'
      }

      mockApi(fetchMock, {
        'GET /v1/teams': { items: [sampleTeam, coastal] },
        'GET /v1/models': { items: catalogue },
        [`GET ${TEAM_PATH}`]: {
          ...teamWithMembers('admin'),
          members: [
            ...teamWithMembers('admin').members,
            { _id: 'member-3', userId: 'user-3', status: 'removed' }
          ]
        },
        [`GET ${TEAM_PATH}/deployments`]: {
          items: [
            deployment(),
            deployment({
              _id: 'deployment-2',
              modelSlug: 'gpt-4-1-nano',
              status: 'deploying'
            }),
            deployment({ _id: 'deployment-3', status: 'removed' })
          ]
        },
        'GET /v1/teams/coastal-team': {
          team: coastal,
          members: [{ _id: 'member-1', userId: 'user-1', status: 'active' }]
        },
        'GET /v1/teams/coastal-team/deployments': {
          items: [
            deployment({ _id: 'deployment-4', status: 'deploy-failed' }),
            deployment({ _id: 'deployment-5', status: 'active' })
          ]
        }
      })

      const { result } = await get('/teams')
      const rows = result.split('data-testid="team-row"').slice(1)

      expect(rows).toHaveLength(2)
      expect(rows[0]).toContain(`href="${TEAM_URL}"`)
      expect(rows[0]).toContain('Flood Risk Team')
      expect(rows[0]).toContain('>Admin<')
      expect(result).toContain('govuk-!-width-one-third" scope="col">Models')
      // The removed member is not counted.
      expect(rows[0]).toMatch(/>2<\/td>/)
      expect(rows[0]).toContain('GPT-4.1 nano, setting up')
      // A ready model needs no words, and a removed one is not listed.
      expect(rows[0]).toMatch(/<li>GPT-4o<\/li>/)
      expect(rows[0].match(/GPT-4o/g)).toHaveLength(1)
      expect(rows[1]).toContain('href="/teams/coastal-team"')
      expect(rows[1]).toContain('>Member<')
      expect(rows[1]).toMatch(/>1<\/td>/)
      // The worse state of a model in more than one place wins, in bold.
      expect(rows[1]).toContain('GPT-4o<strong>, could not be set up</strong>')
    })

    test('says so in a cell that could not be read, rather than failing the page', async () => {
      mockApi(fetchMock, {
        'GET /v1/teams': { items: [sampleTeam] },
        'GET /v1/models': reply(502, { code: 'upstream-unavailable' }),
        [`GET ${TEAM_PATH}`]: reply(502, { code: 'upstream-unavailable' }),
        [`GET ${TEAM_PATH}/deployments`]: { items: [deployment()] }
      })

      const { statusCode, result } = await get('/teams')

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Flood Risk Team')
      expect(result).toContain('Not available')
      // Without the catalogue a model is named by its slug.
      expect(result).toContain('gpt-4o')
    })

    test('says there are no models yet for a team without any', async () => {
      mockApi(fetchMock, {
        'GET /v1/teams': { items: [sampleTeam] },
        'GET /v1/models': { items: catalogue },
        [`GET ${TEAM_PATH}`]: teamWithMembers('admin'),
        [`GET ${TEAM_PATH}/deployments`]: { items: [] }
      })

      const { result } = await get('/teams')

      expect(result).toContain('None yet')
    })
  })

  describe('creating a team', () => {
    test('GET /teams/new asks for the name, service code and what the team does, with a back link to Teams', async () => {
      const { statusCode, result } = await get('/teams/new')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text().trim()).toBe('Create a team')
      expect($('.govuk-back-link').attr('href')).toBe('/teams')
      expect($('label[for="name"]').text().trim()).toBe('Team name')
      expect($('#name-hint').text().trim()).toBe(
        'This also makes your team ID, which cannot be changed later.'
      )
      expect($('#serviceCode').hasClass('govuk-input--width-3')).toBe(true)
      expect($('#serviceCode-hint').text().trim()).toBe(
        '3 letters or numbers, for example FRM. Your team’s AI use is charged to this code.'
      )
      expect($('label[for="description"]').text().trim()).toBe(
        'What the team does (optional)'
      )
      expect($('.govuk-character-count').attr('data-maxlength')).toBe('500')
      expect($('main form button').text().trim()).toBe('Continue')
    })

    test('GET /teams/new is the form even for a team called New, whose ID would be new', async () => {
      const { statusCode, result } = await get('/teams/new')

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Create a team')
      expect(
        fetchMock.mock.calls.filter(([url]) => url.includes('/v1/teams/new'))
      ).toHaveLength(0)
    })

    test('GET /teams/new from a journey goes back to that journey', async () => {
      const { result } = await get(
        '/teams/new?returnTo=%2Fconnect%2Fteam%2Fselect'
      )

      expect(load(result)('.govuk-back-link').attr('href')).toBe(
        '/connect/team/select'
      )
    })

    test('POST /teams/new with an invalid name re-renders the form with errors', async () => {
      const { statusCode, result } = await post('/teams/new', {
        name: 'ab',
        serviceCode: 'ABC'
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toEqual(expect.stringContaining('There is a problem'))
      expect(load(result)('.govuk-back-link').attr('href')).toBe('/teams')
    })

    test('POST /teams/new asks for a service code of three letters or numbers', async () => {
      const { statusCode, result } = await post('/teams/new', {
        name: 'No Code Team',
        serviceCode: ''
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Enter your service code')
    })

    test('POST /teams/new refuses a service code that is not three letters or numbers', async () => {
      const { statusCode, result } = await post('/teams/new', {
        name: 'Bad Code Team',
        serviceCode: 'TOO-LONG'
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain(
        'Service code must be 3 letters or numbers, for example FRM'
      )
    })

    test('POST /teams/new refuses a description over 500 characters', async () => {
      const { statusCode, result } = await post('/teams/new', {
        name: 'Wordy Team',
        serviceCode: 'ABC',
        description: 'x'.repeat(501)
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain(
        'What the team does must be 500 characters or fewer'
      )
    })

    test('GET /teams/new/check with nothing entered goes back to the form', async () => {
      const { statusCode, headers } = await get('/teams/new/check')

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe('/teams/new')
    })

    test('POST /teams/new -> GET check -> POST check creates the team and opens its Members tab', async () => {
      const postNew = await post('/teams/new', {
        name: 'Flood Risk Team',
        serviceCode: 'aip',
        description: 'Checks flood models'
      })

      cookies = mergeCookies(cookies, postNew)
      expect(postNew.statusCode).toBe(statusCodes.seeOther)
      expect(postNew.headers.location).toBe('/teams/new/check')

      const getCheck = await get('/teams/new/check')
      const $ = load(getCheck.result)

      cookies = mergeCookies(cookies, getCheck)
      expect($('h1').text().trim()).toBe('Check your answers')

      const rows = $('.govuk-summary-list__row')
        .map((_, row) => ({
          key: $(row).find('dt').text().trim(),
          value: $(row).find('dd.govuk-summary-list__value').text().trim(),
          change: $(row).find('a').attr('href') ?? null
        }))
        .get()

      expect(rows).toEqual([
        {
          key: 'Team name',
          value: 'Flood Risk Team',
          change: '/teams/new#name'
        },
        {
          key: 'Team ID',
          value: expect.stringMatching(
            /^flood-risk-team\s+Cannot be changed later$/
          ),
          change: null
        },
        { key: 'Service code', value: 'aip', change: '/teams/new#serviceCode' },
        {
          key: 'What the team does',
          value: 'Checks flood models',
          change: '/teams/new#description'
        }
      ])
      expect(getCheck.result).toContain(
        'You will be the team’s first admin. You can add other people, and other admins, once it is created.'
      )
      expect($('main form button').text().trim()).toBe('Create a team')

      fetchMock.mockResponseOnce(JSON.stringify({ team: sampleTeam }))

      const postCheck = await post('/teams/new/check')

      expect(postCheck.statusCode).toBe(statusCodes.seeOther)
      expect(postCheck.headers.location).toBe(`${TEAM_URL}/members`)

      const [, options] = fetchMock.mock.calls.at(-1)

      expect(JSON.parse(options.body)).toEqual({
        name: 'Flood Risk Team',
        serviceCode: 'aip',
        description: 'Checks flood models'
      })
    })

    test('says a description was not given', async () => {
      cookies = mergeCookies(
        cookies,
        await post('/teams/new', { name: 'Quiet Team', serviceCode: 'ABC' })
      )

      const { result } = await get('/teams/new/check')

      expect(result).toContain('Not given')
    })

    test('opens the Members tab of the ID the backend gave, which is numbered when the first choice was taken', async () => {
      cookies = mergeCookies(
        cookies,
        await post('/teams/new', {
          name: 'Flood Risk Team',
          serviceCode: 'ABC'
        })
      )

      fetchMock.mockResponseOnce(
        JSON.stringify({ team: { ...sampleTeam, slug: 'flood-risk-team-2' } })
      )

      const postCheck = await post('/teams/new/check')

      expect(postCheck.headers.location).toBe(
        '/teams/flood-risk-team-2/members'
      )
    })

    test('POST /teams/new/check shows an error for a duplicate team name', async () => {
      cookies = mergeCookies(
        cookies,
        await post('/teams/new', { name: 'Duplicate Team', serviceCode: 'ABC' })
      )

      fetchMock.mockResponseOnce(
        JSON.stringify({
          statusCode: 409,
          error: 'Conflict',
          message: 'A team with this name already exists',
          code: 'team-exists'
        }),
        { status: 409 }
      )

      const postCheck = await post('/teams/new/check')

      expect(postCheck.statusCode).toBe(statusCodes.conflict)
      expect(postCheck.result).toContain('A team with this name already exists')
      expect(postCheck.result).toContain('Check your answers')
      expect(
        load(postCheck.result)('.govuk-error-summary__list a').attr('href')
      ).toBe('/teams/new#name')
    })
  })

  describe('the Overview tab', () => {
    function backend({
      role = 'admin',
      environments = environmentsRead(),
      ...routes
    } = {}) {
      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: teamWithMembers(role),
        [`GET ${ENVIRONMENTS_PATH}`]: environments,
        'GET /v1/models': { items: catalogue },
        ...routes
      })
    }

    const configured = config.get('teamEnvironments')

    afterEach(() => {
      config.set('teamEnvironments', configured)
    })

    test('redirects to /sign-in when signed out', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: TEAM_URL
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toBe(
        `/sign-in?returnTo=${encodeURIComponent(TEAM_URL)}`
      )
    })

    test('names the team, with the tabs and Overview current', async () => {
      backend()

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(
        /govuk-caption-xl[^>]*>Team<\/span>\s*<h1[^>]*>Flood Risk Team<\/h1>/
      )
      expect(result).toContain('aria-current="page">Overview</a>')
      expect(result).not.toContain('>Models</a>')
      expect(result).toContain(`href="${TEAM_URL}/members">Members</a>`)
      expect(result).toContain(`href="${TEAM_URL}/details">Details</a>`)
      // The tab replaces the stacked summary, resource rows and forms.
      expect(result).not.toContain('Change the service code')
      expect(result).not.toContain('What was set up for')
    })

    test('counts what is deployed and federated in each environment, says which are not available yet, and links to the section', async () => {
      backend()

      const { result } = await get(TEAM_URL)
      const $ = load(result)

      expect(
        $('[data-testid="overview-environment"]')
          .map((_, row) => $(row).text().replace(/\s+/g, ' ').trim())
          .get()
      ).toEqual([
        'Infradev Development 2 models, 0 applications',
        'QA Test Not available yet',
        'PREPROD Pre-production Not available yet',
        'PROD Production Not available yet'
      ])
      expect($('a[data-testid="view-environments"]').text().trim()).toBe(
        'View environments and deployments'
      )
      expect($('a[data-testid="view-environments"]').attr('href')).toBe(
        `/environments/${sampleTeam.slug}`
      )
    })

    test('puts the models and the environments each in a summary card under its heading', async () => {
      backend()

      const $ = load((await get(TEAM_URL)).result)

      for (const [title, inside] of [
        ['Models your team uses', '[data-testid="team-models"]'],
        ['Environments and deployments', '[data-testid="overview-environment"]']
      ]) {
        const card = $('.govuk-summary-card.app-section-card').filter(
          (_, element) =>
            $(element)
              .find('.govuk-summary-card__title-wrapper > h2')
              .text()
              .trim() === title
        )

        expect(card).toHaveLength(1)
        expect(card.find(inside).length).toBeGreaterThan(0)
      }

      expect($('main h2.govuk-heading-m')).toHaveLength(0)
      expect($('a[data-testid="view-environments"]').attr('href')).toBe(
        `/environments/${sampleTeam.slug}`
      )
    })

    test('lists the models the team uses, by name, with what is happening to each', async () => {
      backend({
        [`GET ${ENVIRONMENTS_PATH}`]: environmentsRead([
          summary({
            models: {
              count: 1,
              items: [
                { id: 'd-1', modelSlug: 'gpt-4o', status: 'active' },
                { id: 'd-2', modelSlug: 'gpt-4-1-nano', status: 'deploying' },
                { id: 'd-3', modelSlug: 'gpt-5-mini', status: 'removed' }
              ]
            }
          })
        ])
      })

      const { result } = await get(TEAM_URL)
      const $ = load(result)

      expect(
        $('[data-testid="team-models"] li')
          .map((_, item) => $(item).text().replace(/\s+/g, ' ').trim())
          .get()
      ).toEqual(['GPT-4.1 nano, setting up', 'GPT-4o'])
    })

    test('says there are no models yet when the team has none', async () => {
      backend({
        [`GET ${ENVIRONMENTS_PATH}`]: environmentsRead([
          summary({ models: { count: 0, items: [] } })
        ])
      })

      const { result } = await get(TEAM_URL)

      expect(load(result)('[data-testid="team-models-none"]').text()).toContain(
        'No models yet'
      )
    })

    test('shows a member the same overview', async () => {
      backend({ role: 'user' })

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('2 models, 0 applications')
    })

    test('reads the team and its environments, and nothing else of any other team', async () => {
      backend()

      await get(TEAM_URL)

      const paths = fetchMock.mock.calls
        .map(([url]) => new URL(url).pathname)
        .filter((path) => path.startsWith('/v1/') && path !== '/v1/users/me')

      for (const path of paths) {
        expect(
          path === '/v1/models' ||
            path === TEAM_PATH ||
            path.startsWith(`${TEAM_PATH}/`)
        ).toBe(true)
      }
    })

    test('is not found for a person who is not on the team, such as one with only their own keys', async () => {
      backend({ [`GET ${TEAM_PATH}`]: NOT_FOUND })

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Team not found')
      expect(result).not.toContain('Flood Risk Team')
      expect(
        fetchMock.mock.calls.filter(([url]) => url.includes('/environments'))
      ).toHaveLength(0)
    })

    test('does not turn a backend fault reading the team into a not found page', async () => {
      backend({
        [`GET ${TEAM_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('says so, with a link to the section, when the environments cannot be read, and still shows the team', async () => {
      backend({
        [`GET ${ENVIRONMENTS_PATH}`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { statusCode, result } = await get(TEAM_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text()).toBe('Flood Risk Team')
      expect($('[data-testid="overview-unavailable"]').text()).toContain(
        'We could not read this team’s environments just now'
      )
      expect($('a[data-testid="view-environments"]').attr('href')).toBe(
        `/environments/${sampleTeam.slug}`
      )
    })

    test('names a model by its slug when the catalogue cannot be read', async () => {
      backend({
        'GET /v1/models': reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('gpt-4o')
    })

    test('has no status fragment of its own now: progress is shown in the section', async () => {
      backend()

      const { result, headers } = await get(`${TEAM_URL}?fragment=status`)

      expect(result).toContain('<html')
      expect(headers.etag).toBeUndefined()
      expect(result).not.toContain('data-progress-refresh')
    })

    test('redirects the old Models tab address to the overview in the section', async () => {
      const { statusCode, headers } = await get(`${TEAM_URL}/models`)

      expect(statusCode).toBe(statusCodes.movedPermanently)
      expect(headers.location).toBe(`/environments/${sampleTeam.slug}`)
    })

    test('counts each environment, and says nothing is not available, when all four are available', async () => {
      config.set('teamEnvironments', ['infradev', 'qa', 'preprod', 'prod'])
      backend({
        [`GET ${ENVIRONMENTS_PATH}`]: environmentsRead(
          ['infradev', 'qa', 'preprod', 'prod'].map((environment) =>
            summary({ environment })
          )
        )
      })

      const { result } = await get(TEAM_URL)
      const $ = load(result)

      expect(result).not.toContain('Not available yet')
      expect($('[data-testid="overview-environment"]')).toHaveLength(4)
    })
  })
})

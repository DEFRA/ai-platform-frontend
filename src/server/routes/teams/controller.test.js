import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
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

const teamCredential = {
  _id: 'cred-1',
  tier: 'team',
  teamId: 'team-1',
  environment: 'infradev',
  status: 'active',
  expiresAt: '2027-10-19T00:00:00.000Z',
  createdAt: '2026-10-21T10:45:00.000Z'
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

  function get(url) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
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

  describe('the Models tab', () => {
    function backend({
      role = 'admin',
      deployments = [deployment()],
      credentials = [teamCredential],
      environments = [
        {
          environment: 'infradev',
          limits: { requestsPerMinute: 60, tokensPerMinute: 1000 }
        }
      ],
      ...routes
    } = {}) {
      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: { ...teamWithMembers(role), environments },
        [`GET ${TEAM_PATH}/deployments`]: { items: deployments },
        'GET /v1/models': { items: catalogue },
        'GET /v1/credentials': { items: credentials },
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

    test('names the team, with the tabs and Models current', async () => {
      backend()

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(
        /govuk-caption-xl[^>]*>Team<\/span>\s*<h1[^>]*>Flood Risk Team<\/h1>/
      )
      expect(result).toContain('aria-current="page">Models</a>')
      expect(result).toContain(`href="${TEAM_URL}/members">Members</a>`)
      expect(result).toContain(`href="${TEAM_URL}/details">Details</a>`)
      // The tab replaces the stacked summary, resource rows and forms.
      expect(result).not.toContain('Change the service code')
      expect(result).not.toContain('What was set up for')
    })

    test('shows an admin a card for the environment with its models, client secret and limits', async () => {
      backend({
        deployments: [
          deployment(),
          deployment({
            _id: 'deployment-2',
            modelSlug: 'gpt-4-1-nano',
            status: 'checks-failed'
          })
        ]
      })

      const { result } = await get(TEAM_URL)

      expect(result).toContain('data-testid="environment-card"')
      expect(result).toContain('>Development</h2>')
      expect(result).toMatch(/href="\/connect\/team\/start"[^>]*>Add a model/)
      expect(result).toContain('Ready to use')
      expect(result).toContain('govuk-tag--green')
      expect(result).toContain('Setup failed')
      expect(result).toContain('govuk-tag--red')
      expect(result).toContain(
        'href="/connect/team/request/flood-risk-team/deployment-2"'
      )
      expect(result).toContain('See what happened')
      // Remove is for a ready model and a failed one.
      expect(result).toContain(`href="${TEAM_URL}/models/deployment-1/remove"`)
      expect(result).toContain(`href="${TEAM_URL}/models/deployment-2/remove"`)
      expect(result).toContain('Expires 19 October 2027')
      expect(result).toContain(`href="${TEAM_URL}/client-secrets/cred-1/view"`)
      expect(result).toContain(
        `href="${TEAM_URL}/client-secrets/cred-1/rotate"`
      )
      expect(result).toContain(
        `href="${TEAM_URL}/client-secrets/cred-1/revoke"`
      )
      expect(result).not.toContain('Ask an admin for it')
      expect(result).toContain('60 requests and 1,000 tokens a minute')
      expect(result).toContain(
        'Test, Pre-production and Production are not available yet.'
      )
      expect(result).toContain(
        'To change your limits, <a class="govuk-link" href="mailto:AICapabilityAndEnablement@defra.gov.uk">contact the AI Platform team</a>.'
      )
    })

    test('shows a member the same models, with no change actions, and tells them to ask an admin for the secret', async () => {
      backend({ role: 'user' })

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('GPT-4o')
      expect(result).toContain('Ready to use')
      expect(result).toContain('Expires 19 October 2027')
      expect(result).toContain('Ask an admin for it')
      expect(result).toContain('60 requests and 1,000 tokens a minute')
      expect(result).toMatch(/href="\/connect\/team\/start"[^>]*>Add a model/)
      expect(result).not.toContain('/models/deployment-1/remove')
      expect(result).not.toContain('/client-secrets/')
    })

    test('is not found for a person who is not on the team, such as one with only their own keys', async () => {
      backend({ [`GET ${TEAM_PATH}`]: NOT_FOUND })

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Team not found')
      expect(result).not.toContain('Flood Risk Team')
      expect(
        fetchMock.mock.calls.filter(([url]) => url.includes('/deployments'))
      ).toHaveLength(0)
    })

    test('does not turn a backend fault reading the team into a not found page', async () => {
      backend({
        [`GET ${TEAM_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('says what each state of a model is, and refreshes itself while one is changing', async () => {
      backend({
        deployments: [
          deployment({ _id: 'd-1', status: 'deploying' }),
          deployment({
            _id: 'd-2',
            modelSlug: 'gpt-4-1-nano',
            status: 'queued'
          }),
          deployment({
            _id: 'd-3',
            modelSlug: 'gpt-5-mini',
            status: 'removing'
          })
        ]
      })

      const { result } = await get(TEAM_URL)

      expect(result).toContain('http-equiv="refresh"')
      expect(result).toContain('Setting up')
      expect(result).toContain('Waiting for another change')
      expect(result).toContain('Removing')
      expect(result).toContain('govuk-tag--yellow')
      // Something still being set up has its progress to see; a removal has
      // no actions at all.
      expect(result).toContain(
        'href="/connect/team/request/flood-risk-team/d-1"'
      )
      expect(result).not.toContain('/models/d-1/remove')
      expect(result).not.toContain('/models/d-3/remove')
      expect(result).not.toContain('/request/flood-risk-team/d-3')
    })

    test('does not refresh when nothing is changing', async () => {
      backend()

      const { result } = await get(TEAM_URL)

      expect(result).not.toContain('http-equiv="refresh"')
    })

    test('a removal that failed returns the model as ready, with the reason', async () => {
      backend({
        deployments: [deployment({ failureReason: 'The change was rejected.' })]
      })

      const { result } = await get(TEAM_URL)

      expect(result).toContain('Ready to use')
      expect(result).toContain('The change was rejected.')
    })

    test('names a model by its slug when the catalogue cannot be read', async () => {
      backend({
        'GET /v1/models': reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('gpt-4o')
    })

    test('shows no date for a client secret that does not say when it expires', async () => {
      backend({ credentials: [{ ...teamCredential, expiresAt: null }] })

      const { result } = await get(TEAM_URL)

      expect(result).not.toContain('Expires')
      expect(result).toContain(`href="${TEAM_URL}/client-secrets/cred-1/view"`)
    })

    test.each([
      [
        'one not in the vault yet',
        [{ ...teamCredential, vaultState: 'unwritten' }],
        'Being prepared'
      ],
      [
        'one revoked after the model turned active',
        [
          {
            ...teamCredential,
            status: 'revoked',
            revokedAt: '2026-10-22T09:00:00.000Z'
          }
        ],
        'Revoked'
      ],
      ['none yet', [], 'Ready once a model has been set up.']
    ])(
      'says where the client secret is with %s, and offers nothing to do with it',
      async (_name, credentials, text) => {
        backend({
          credentials,
          deployments: [deployment({ activatedAt: '2026-10-21T10:45:00.000Z' })]
        })

        const { result } = await get(TEAM_URL)

        expect(result).toContain(text)
        expect(result).not.toContain('/client-secrets/')
      }
    )

    test('says the client secret could not be checked when the credentials cannot be read', async () => {
      backend({
        'GET /v1/credentials': reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('We could not check this just now.')
    })

    test('reads the credentials only after the deployments, which is what grants a model that just turned active its team secret', async () => {
      let granted = false

      backend({
        [`GET ${TEAM_PATH}/deployments`]: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          granted = true

          return { items: [deployment()] }
        },
        'GET /v1/credentials': () => ({
          items: granted ? [teamCredential] : []
        })
      })

      const { result } = await get(TEAM_URL)

      expect(result).toContain('Expires 19 October 2027')
      expect(result).not.toContain('Ready once a model has been set up.')
    })

    test('does not read the credentials when the models could not be listed', async () => {
      backend({
        [`GET ${TEAM_PATH}/deployments`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      await get(TEAM_URL)

      expect(
        fetchMock.mock.calls.some(([url]) => url.includes('/v1/credentials'))
      ).toBe(false)
    })

    test('says so, rather than showing an empty team, when the models cannot be listed', async () => {
      backend({
        [`GET ${TEAM_PATH}/deployments`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { statusCode, result } = await get(TEAM_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('data-testid="team-models-unavailable"')
      expect(result).not.toContain('data-testid="environment-card"')
    })

    test('hides the client secret and limits of an environment with no models, and offers to set up one never set up', async () => {
      config.set('teamEnvironments', ['infradev', 'qa'])
      backend({ deployments: [deployment()] })

      const { result } = await get(TEAM_URL)

      expect(result).toContain('>Test</h2>')
      expect(result).toContain(
        'Not set up. Test gets its own deployments, client secret and limits.'
      )
      expect(result).toContain(
        `<a class="govuk-link" href="${TEAM_URL}/test" data-testid="set-up-environment">Set up Test</a>`
      )
      expect(result).toContain(
        'Pre-production and Production are not available yet.'
      )
      // Only the Development card has a client secret.
      expect(result.split('data-testid="secret-row"')).toHaveLength(2)
    })

    test('adds a model to another environment from its own page', async () => {
      config.set('teamEnvironments', ['infradev', 'qa'])
      backend({
        deployments: [
          deployment(),
          deployment({ _id: 'd-9', environment: 'qa' })
        ]
      })

      const { result } = await get(TEAM_URL)

      expect(result).toMatch(/href="\/connect\/team\/start"[^>]*>Add a model/)
      expect(result).toMatch(
        /href="\/teams\/flood-risk-team\/test"[^>]*>Add a model/
      )
    })

    test('after the last model is removed: says there are none, and offers to add one, with no client secret', async () => {
      backend({ deployments: [deployment({ status: 'removed' })] })

      const { result } = await get(TEAM_URL)

      expect(result).toContain('No models in Development')
      expect(result).toMatch(/href="\/connect\/team\/start"[^>]*>Add a model/)
      expect(result).not.toContain('data-testid="secret-row"')
      expect(result).not.toContain('Not set up.')
    })

    test('says nothing about environments not available when all four are', async () => {
      config.set('teamEnvironments', ['infradev', 'qa', 'preprod', 'prod'])
      backend()

      const { result } = await get(TEAM_URL)

      expect(result).not.toContain('not available yet')
    })
  })
})

import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  INFRADEV_URL,
  OVERVIEW_URL,
  TEAM_PATH,
  detail,
  doneOperation,
  environmentsRead,
  failedOperation,
  openOperation,
  operationsAnswer,
  summary,
  teamCredential
} from '#/test-helpers/environments-helpers.js'
import {
  signInViaOidc,
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

const NOT_MEMBER = reply(404, { code: 'not-a-member', message: 'Not found' })
const coastal = {
  _id: 'team-2',
  slug: 'coastal-team',
  name: 'Coastal Team',
  role: 'user'
}

function pageOf(result) {
  return load(result)
}

function text(scope, selector) {
  const matches =
    typeof scope === 'function' ? scope(selector) : scope.find(selector)

  return matches.text().replace(/\s+/g, ' ').trim()
}

describe('#environmentsController', () => {
  let server
  let cookies
  const configured = config.get('teamEnvironments')

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
    config.set('teamEnvironments', configured)
  })

  afterEach(() => {
    config.set('teamEnvironments', configured)
  })

  function get(url, headers = {}) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies), ...headers }
    })
  }

  // What the pages read. A test changes only what it is about.
  function backend(routes = {}, role = 'admin') {
    mockApi(fetchMock, {
      'GET /v1/teams': { items: [sampleTeam] },
      'GET /v1/models': { items: [sampleModel, nanoModel] },
      'GET /v1/credentials': { items: [teamCredential] },
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${TEAM_PATH}/environments`]: environmentsRead(),
      [`GET ${TEAM_PATH}/environments/infradev`]: detail(),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      ...routes
    })
  }

  // What the page asked the backend for, leaving out the sign-in's own call.
  function calledPaths() {
    return fetchMock.mock.calls
      .map(([url]) => new URL(url).pathname)
      .filter((path) => path.startsWith('/v1/') && path !== '/v1/users/me')
  }

  describe('GET /environments (choose a team)', () => {
    test('redirects to the sign-in page when signed out', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/environments'
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/sign-in?returnTo=%2Fenvironments')
    })

    test('goes straight to the team when the person has one', async () => {
      backend()

      const { statusCode, headers } = await get('/environments')

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe(OVERVIEW_URL)
      expect(calledPaths()).toEqual(['/v1/teams'])
    })

    test('lists only the person’s own teams when they have several, each linking to its overview', async () => {
      backend({ 'GET /v1/teams': { items: [sampleTeam, coastal] } })

      const { statusCode, result } = await get('/environments')
      const $ = pageOf(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(text($, 'h1')).toBe('Environments and deployments')
      expect(
        $('[data-testid="team-link"]')
          .map((_, link) => [[$(link).text().trim(), $(link).attr('href')]])
          .get()
      ).toEqual([
        ['Flood Risk Team', OVERVIEW_URL],
        ['Coastal Team', '/environments/coastal-team']
      ])
      expect(calledPaths()).toEqual(['/v1/teams'])
    })

    test('offers to create a team when the person has none', async () => {
      backend({ 'GET /v1/teams': { items: [] } })

      const { statusCode, result } = await get('/environments')
      const $ = pageOf(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(text($, 'main')).toContain('You are not a member of a team yet')
      expect($('a[href="/teams/new"]').text().trim()).toBe('Create a team')
      expect($('[data-testid="team-link"]')).toHaveLength(0)
    })

    test('says it could not list the teams when the backend is unavailable', async () => {
      backend({ 'GET /v1/teams': reply(502, { code: 'upstream-unavailable' }) })

      const { statusCode, result } = await get('/environments')

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(pageOf(result)('main').text()).toContain('We could not')
    })
  })

  describe(`GET ${OVERVIEW_URL} (the overview)`, () => {
    test('reads only that team: every team route carries its slug, and nothing lists other teams’ data', async () => {
      backend({
        'GET /v1/teams': { items: [sampleTeam, coastal] }
      })

      const { statusCode } = await get(OVERVIEW_URL)

      expect(statusCode).toBe(statusCodes.ok)

      for (const path of calledPaths()) {
        expect(
          path === '/v1/teams' ||
            path === '/v1/models' ||
            path.startsWith(`${TEAM_PATH}/`)
        ).toBe(true)
      }

      expect(calledPaths()).not.toContain('/v1/teams/coastal-team')
      expect(calledPaths().some((path) => path.includes('/deployments'))).toBe(
        false
      )
    })

    test('shows Infradev’s card with its models, applications, token limit and latest change, and a card for each other environment saying Not available yet', async () => {
      backend()

      const { result } = await get(OVERVIEW_URL)
      const $ = pageOf(result)

      expect(text($, 'h1')).toBe('Environments and deployments')
      expect(text($, '[data-testid="app-heading-caption"]')).toBe(
        'Flood Risk Team'
      )
      expect($('title').text()).toContain(
        'Environments and deployments - Flood Risk Team'
      )

      const infradev = $('[data-testid="environment-card-infradev"]')

      expect(text(infradev, '.govuk-summary-card__title')).toContain('Infradev')
      expect(text(infradev, '[data-testid="card-tag"]')).toBe('Available')
      expect(text(infradev, '.govuk-summary-list')).toContain('Models 2')
      expect(text(infradev, '.govuk-summary-list')).toContain(
        'Applications 0 of 20'
      )
      expect(text(infradev, '.govuk-summary-list')).toContain(
        'Tokens a minute 1,000'
      )
      expect(text(infradev, '.govuk-summary-list')).toContain(
        'Latest change Deploy GPT-4o: Done'
      )
      expect(infradev.find('a[data-testid="card-link"]').attr('href')).toBe(
        INFRADEV_URL
      )

      for (const code of ['qa', 'preprod', 'prod']) {
        const card = $(`[data-testid="environment-card-${code}"]`)

        expect(text(card, '[data-testid="card-tag"]')).toBe('Not available yet')
        // Styled through its own classes, never by overriding GOV.UK's.
        expect(card.hasClass('app-environment-card--unavailable')).toBe(true)
        expect(card.find('.app-environment-card__title-wrapper')).toHaveLength(
          1
        )
        expect(card.find('.app-environment-card__title')).toHaveLength(1)
        expect(card.find('.app-environment-card__content')).toHaveLength(1)
        expect(card.find('a')).toHaveLength(0)
        expect(card.find('button')).toHaveLength(0)
      }
    })

    test('offers Deploy a model with the team already chosen, and no Create Passwordless Credential action yet', async () => {
      backend()

      const $ = pageOf((await get(OVERVIEW_URL)).result)
      const deploy = $('a[data-testid="deploy-a-model"]')

      expect(deploy.text().trim()).toBe('Deploy a model')
      expect(deploy.attr('href')).toBe(
        `/connect/team/start?teamId=${sampleTeam.slug}`
      )
      expect(text($, 'main')).not.toContain('Create Passwordless Credential')
    })

    test('lays the environment cards side by side, and puts the changes in progress and the recent changes in cards of their own, across the full width', async () => {
      backend()

      const $ = pageOf((await get(OVERVIEW_URL)).result)
      const grid = $('[data-testid="environment-cards"]')

      expect(grid.hasClass('app-card-grid')).toBe(true)
      expect(grid.children('.govuk-summary-card')).toHaveLength(4)
      expect(grid.children('.app-environment-card')).toHaveLength(4)
      expect($('[data-testid="environments-status"] > h2').text().trim()).toBe(
        'Your environments'
      )

      for (const [testId, title] of [
        ['section-changes', 'Changes in progress'],
        ['section-recent', 'Recent changes']
      ]) {
        const card = $(`[data-testid="${testId}"]`)

        expect(card.hasClass('govuk-summary-card')).toBe(true)
        expect(text(card, '.govuk-summary-card__title-wrapper > h2')).toBe(
          title
        )
        expect(grid.find(`[data-testid="${testId}"]`)).toHaveLength(0)
      }

      expect(
        $('.govuk-heading-l')
          .map((_, heading) => $(heading).text().trim())
          .get()
      ).toEqual(['Your environments'])
      expect(
        $('[data-testid="environments-status"]').closest(
          '.govuk-grid-column-two-thirds'
        )
      ).toHaveLength(0)
      expect(
        $('[data-testid="deploy-a-model"]').closest(
          '.govuk-grid-column-two-thirds'
        )
      ).toHaveLength(0)
    })

    test('right aligns the actions above the cards', async () => {
      backend({ 'GET /v1/teams': { items: [sampleTeam, coastal] } })

      const $ = pageOf((await get(OVERVIEW_URL)).result)
      const actions = $('[data-testid="page-actions"]')

      expect(actions.hasClass('app-actions--end')).toBe(true)
      expect(actions.find('a[data-testid="deploy-a-model"]')).toHaveLength(1)
      expect(actions.find('a[data-testid="change-team"]')).toHaveLength(1)
      expect(
        actions
          .find('a[data-testid="deploy-a-model"]')
          .hasClass('govuk-!-margin-bottom-0')
      ).toBe(true)
    })

    test('shows Change team only to a person with more than one team', async () => {
      backend()
      const single = pageOf((await get(OVERVIEW_URL)).result)

      expect(single('a[data-testid="change-team"]')).toHaveLength(0)

      backend({ 'GET /v1/teams': { items: [sampleTeam, coastal] } })
      const several = pageOf((await get(OVERVIEW_URL)).result)

      expect(several('a[data-testid="change-team"]').attr('href')).toBe(
        '/environments'
      )
    })

    test('shows each change in progress with its steps and times, and the recent changes with their dates', async () => {
      backend({
        [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
          open: [openOperation()],
          recent: [
            doneOperation({ createdAt: '2020-11-10T09:00:00.000Z' }),
            failedOperation({ createdAt: '2020-11-09T09:00:00.000Z' })
          ]
        })
      })

      const $ = pageOf((await get(OVERVIEW_URL)).result)
      const progress = $('[data-testid="change-in-progress"]')

      expect(progress).toHaveLength(1)
      expect(text(progress, 'h3')).toBe('Deploying GPT-4o in Infradev')
      expect(text(progress, '[data-testid="asked-by"]')).toBe(
        'Asked for by Jo Bloggs at 10:41'
      )
      expect(
        progress
          .find('[data-testid="step-list-item"] .app-step-list__label')
          .map((_, label) => $(label).text().replace(/\s+/g, ' ').trim())
          .get()
      ).toEqual([
        'Done: Request received',
        'Done: Checks passed',
        'In progress: Deploying',
        'Not started: Deployed',
        'Not started: Ready to use'
      ])
      expect(text(progress, '.app-step-list__hint')).toContain('10:41')
      expect(
        progress.find('a[data-testid="view-environment"]').attr('href')
      ).toBe(INFRADEV_URL)
      expect($('a[data-testid="check-progress"]').attr('href')).toBe(
        OVERVIEW_URL
      )

      const rows = $('[data-testid="recent-change"]')

      expect(rows).toHaveLength(2)
      expect(text(rows.eq(0), 'td')).toContain('10 November')
      expect(text(rows.eq(0), 'td')).toContain('Deploy GPT-4o in Infradev')
      expect(text($, '[data-testid="recent-changes"] th')).not.toContain(
        'Environment'
      )
      expect(text(rows.eq(0), '.govuk-tag')).toBe('Done')
      expect(text(rows.eq(1), '.govuk-tag')).toBe('Failed')
    })

    test('says there is nothing in progress and nothing recent when there are no changes', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments`]: environmentsRead([
          summary({ latestOperation: null })
        ])
      })

      const $ = pageOf((await get(OVERVIEW_URL)).result)

      expect($('[data-testid="no-changes-in-progress"]').text()).toContain(
        'No changes in progress'
      )
      expect($('[data-testid="no-recent-changes"]').text()).toContain(
        'No recent changes'
      )
    })

    test('lets an environment that is available but not set up offer its set up, and the first one offer a deploy', async () => {
      config.set('teamEnvironments', ['infradev', 'qa'])
      backend({
        [`GET ${TEAM_PATH}/environments`]: environmentsRead([
          summary({
            setUp: false,
            limits: null,
            models: { count: 0, items: [] },
            latestOperation: null
          }),
          summary({
            environment: 'qa',
            setUp: false,
            limits: null,
            models: { count: 0, items: [] },
            latestOperation: null
          })
        ])
      })

      const $ = pageOf((await get(OVERVIEW_URL)).result)

      expect(text($, '[data-testid="environment-card-infradev"]')).toContain(
        'Not set up yet. Deploy a model to set up Infradev.'
      )
      expect(
        $(
          '[data-testid="environment-card-qa"] a[data-testid="set-up-environment"]'
        ).attr('href')
      ).toBe(`${OVERVIEW_URL}/qa/set-up`)
    })

    test('is a 404 with nothing about the team for a person who is not a member', async () => {
      backend({ [`GET ${TEAM_PATH}/environments`]: NOT_MEMBER })

      const { statusCode, result } = await get(OVERVIEW_URL)
      const $ = pageOf(result)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(text($, 'h1')).toBe('Team not found')
      expect(text($, 'main')).not.toContain('Flood Risk Team')
      // Nothing else about the team is asked for.
      expect(calledPaths()).toEqual([`${TEAM_PATH}/environments`])
    })

    test('says it could not read the environments when the backend is unavailable', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { statusCode, result } = await get(OVERVIEW_URL)

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(pageOf(result), 'main')).toContain(
        'We could not read this team’s environments just now'
      )
    })

    test('still shows the cards when the changes or model names cannot be read', async () => {
      backend({
        [`GET ${TEAM_PATH}/operations`]: reply(502, {
          code: 'upstream-unavailable'
        }),
        'GET /v1/models': reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode, result } = await get(OVERVIEW_URL)
      const $ = pageOf(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="environment-card-infradev"]')).toHaveLength(1)
      expect($('[data-testid="changes-unavailable"]').text()).toContain(
        'We could not read the changes just now'
      )
    })
  })

  describe('the status fragment of the overview', () => {
    test('is the cards and changes on their own, never cached, with an ETag, and says whether anything is in progress', async () => {
      backend({
        [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
          open: [openOperation()]
        })
      })

      const { statusCode, headers, result } = await get(
        `${OVERVIEW_URL}?fragment=status`
      )
      const $ = pageOf(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(headers['cache-control']).toBe('no-store')
      expect(headers.etag).toBeTruthy()
      expect($('title')).toHaveLength(0)
      expect($('[data-in-progress]').attr('data-in-progress')).toBe('true')
      expect($('[data-testid="change-in-progress"]')).toHaveLength(1)
    })

    test('says nothing is in progress once nothing is', async () => {
      backend()

      const { result } = await get(`${OVERVIEW_URL}?fragment=status`)

      expect(
        pageOf(result)('[data-in-progress]').attr('data-in-progress')
      ).toBe('false')
    })

    test('the page wraps the status in a polite live region that the script follows', async () => {
      backend()

      const $ = pageOf((await get(OVERVIEW_URL)).result)
      const region = $('[data-progress-refresh]')

      expect(region.attr('aria-live')).toBe('polite')
      expect(region.attr('data-progress-refresh')).toBe(
        `${OVERVIEW_URL}?fragment=status`
      )
      expect(region.find('[data-in-progress]')).toHaveLength(1)
    })

    test('is a 404 for a person who is not a member, and 503 when it cannot be read', async () => {
      backend({ [`GET ${TEAM_PATH}/environments`]: NOT_MEMBER })
      expect((await get(`${OVERVIEW_URL}?fragment=status`)).statusCode).toBe(
        statusCodes.notFound
      )

      backend({
        [`GET ${TEAM_PATH}/environments`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })
      const unavailable = await get(`${OVERVIEW_URL}?fragment=status`)

      expect(unavailable.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(unavailable.headers['cache-control']).toBe('no-store')
    })
  })

  describe(`GET ${INFRADEV_URL} (an environment)`, () => {
    test('asks for only that team’s data, and only that environment’s changes', async () => {
      backend()

      const { statusCode } = await get(INFRADEV_URL)

      expect(statusCode).toBe(statusCodes.ok)

      for (const path of calledPaths()) {
        expect(
          ['/v1/models', '/v1/credentials'].includes(path) ||
            path === TEAM_PATH ||
            path.startsWith(`${TEAM_PATH}/`)
        ).toBe(true)
      }

      const operationCalls = fetchMock.mock.calls
        .map(([url]) => new URL(url))
        .filter(({ pathname }) => pathname.endsWith('/operations'))

      expect(operationCalls).toHaveLength(2)

      for (const url of operationCalls) {
        expect(url.searchParams.get('environment')).toBe('infradev')
      }
    })

    test('puts each section in a summary card of its own across the full width, with Deploy a model right aligned in the Models card', async () => {
      backend()

      const $ = pageOf((await get(INFRADEV_URL)).result)
      const status = $('[data-testid="environment-status"]')

      expect(
        status
          .children('.govuk-summary-card')
          .map((_, card) =>
            text($(card), '.govuk-summary-card__title-wrapper > h2')
          )
          .get()
      ).toEqual(['Changes in progress', 'Models', 'Limits', 'Recent changes'])
      expect($('.govuk-heading-l')).toHaveLength(0)
      expect(status.closest('.govuk-grid-column-two-thirds')).toHaveLength(0)
      expect(
        $('nav[aria-label="Environments"]').closest(
          '.govuk-grid-column-two-thirds'
        )
      ).toHaveLength(0)

      const models = $('[data-testid="section-models"]')

      expect(
        models.find(
          '.app-section-card__actions a.govuk-button[data-testid="deploy-a-model"]'
        )
      ).toHaveLength(1)
      expect(
        models
          .find('a[data-testid="deploy-a-model"]')
          .hasClass('govuk-!-margin-bottom-0')
      ).toBe(true)
      expect(
        $('[data-testid="section-limits"]').find(
          'a[data-testid="change-limits"]'
        )
      ).toHaveLength(1)
      expect(
        $('[data-testid="section-changes"]').find(
          '[data-testid="no-changes-in-progress"]'
        )
      ).toHaveLength(1)
      expect(
        $('[data-testid="section-recent"]').find('table, p')
      ).not.toHaveLength(0)
    })

    test('shows the strip with this environment marked current and the others not available', async () => {
      backend()

      const $ = pageOf((await get(INFRADEV_URL)).result)
      const strip = $('nav[aria-label="Environments"]')

      expect(strip.find('[aria-current="page"]').text()).toContain('Infradev')
      expect(strip.find('[aria-current="page"]').attr('href')).toBe(
        INFRADEV_URL
      )
      expect(strip.find('a')).toHaveLength(1)
      expect(strip.text()).toContain('QA')
      expect(strip.text()).toContain('Not available yet')
      expect(text($, 'h1')).toBe('Infradev')
      expect(text($, '[data-testid="app-heading-caption"]')).toBe(
        'Flood Risk Team'
      )
    })

    test('shows this environment’s models, with a state each, and the Deploy a model action carrying the environment', async () => {
      backend()

      const $ = pageOf((await get(INFRADEV_URL)).result)
      const rows = $('[data-testid="model-row"]')

      expect(
        rows.map((_, row) => $(row).find('dt').text().trim()).get()
      ).toEqual(['GPT-4o', 'GPT-4.1 nano'])
      expect(text(rows.eq(0), '.govuk-tag')).toBe('Ready to use')
      expect($('a[data-testid="deploy-a-model"]').attr('href')).toBe(
        `/connect/team/start?teamId=${sampleTeam.slug}&environment=infradev`
      )
    })

    test('shows the limits, and Change only to an admin; a member sees neither Remove, Change nor secret actions', async () => {
      backend({}, 'admin')
      const admin = pageOf((await get(INFRADEV_URL)).result)

      expect(text(admin, '[data-testid="limits-row-tokens"]')).toContain(
        '1,000'
      )
      expect(text(admin, '[data-testid="limits-row-requests"]')).toContain('60')
      expect(admin('a[data-testid="change-limits"]').attr('href')).toBe(
        `${INFRADEV_URL}/limits`
      )
      expect(admin('a[data-testid="model-remove"]')).toHaveLength(2)
      expect(admin('[data-testid="secret-row"] a')).toHaveLength(3)

      backend({}, 'user')
      const member = pageOf((await get(INFRADEV_URL)).result)

      expect(member('a[data-testid="change-limits"]')).toHaveLength(0)
      expect(member('a[data-testid="model-remove"]')).toHaveLength(0)
      expect(member('[data-testid="secret-row"] a')).toHaveLength(0)
      expect(member('[data-testid="ask-an-admin"]').text()).toBe(
        'Ask an admin for it'
      )
      expect(member('a[data-testid="deploy-a-model"]')).toHaveLength(1)
    })

    test('says a limits change is on its way, with what it will set', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          pendingLimits: { tokensPerMinute: 2000, requestsPerMinute: 120 }
        })
      })

      const $ = pageOf((await get(INFRADEV_URL)).result)

      expect($('[data-testid="limits-pending"]').text().trim()).toBe(
        'Changing to 2,000 tokens and 120 requests a minute'
      )
    })

    test('shows the changes in progress of this environment, with a see progress link for the model', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          models: [
            {
              _id: 'deployment-3',
              teamId: 'team-1',
              modelSlug: 'gpt-4o',
              environment: 'infradev',
              status: 'deploying'
            }
          ],
          inProgress: true
        }),
        [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
          open: [openOperation()]
        })
      })

      const $ = pageOf((await get(INFRADEV_URL)).result)

      expect(text($, '[data-testid="change-in-progress"] h3')).toBe(
        'Deploying GPT-4o in Infradev'
      )
      expect($('[data-in-progress]').attr('data-in-progress')).toBe('true')
      expect(
        $('[data-testid="model-row"] a[href^="/connect/team/request/"]').attr(
          'href'
        )
      ).toBe(`/connect/team/request/${sampleTeam.slug}/deployment-3`)
    })

    test('shows why a recent change failed, with the run to follow and the reference to quote', async () => {
      backend({
        [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
          recent: [failedOperation()]
        })
      })

      const $ = pageOf((await get(INFRADEV_URL)).result)
      const failure = $('[data-testid="recent-change"] [data-testid="failure"]')

      expect(failure.text()).toContain(
        'The platform checks refused the change.'
      )
      expect(failure.find('a').attr('href')).toBe(
        'https://github.com/DEFRA/ai-platform-tenants/actions/runs/42'
      )
      expect(failure.text()).toContain('AIP-24680')
    })

    test('offers to deploy and set up when the environment is not set up, with no limits to change', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          setUp: false,
          models: [],
          limits: null,
          limitBounds: null,
          latestOperation: null
        })
      })

      const $ = pageOf((await get(INFRADEV_URL)).result)

      expect($('[data-testid="no-models"]').text()).toContain(
        'No models in Infradev'
      )
      expect($('a[data-testid="change-limits"]')).toHaveLength(0)
      expect($('[data-testid="limits-row-tokens"]')).toHaveLength(0)
      expect($('a[data-testid="deploy-a-model"]')).toHaveLength(1)
    })

    test('says an environment is paused', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({ paused: true })
      })

      const $ = pageOf((await get(INFRADEV_URL)).result)

      expect(text($, '[data-testid="environment-tag"]')).toBe('Paused')
      expect($('[data-testid="paused-note"]').text()).toContain(
        'Changes wait here until the platform team resumes Infradev.'
      )
    })

    test.each(['qa', 'nowhere', 'INFRADEV'])(
      'is a 404 for %s, an environment that is unknown or not available, without asking the backend',
      async (code) => {
        backend()

        const { statusCode, result } = await get(`${OVERVIEW_URL}/${code}`)

        expect(statusCode).toBe(statusCodes.notFound)
        expect(text(pageOf(result), 'h1')).toBe('Environment not found')
        expect(calledPaths()).toEqual([])
      }
    )

    test('is a 404 with nothing about the team for a person who is not a member', async () => {
      backend({ [`GET ${TEAM_PATH}/environments/infradev`]: NOT_MEMBER })

      const { statusCode, result } = await get(INFRADEV_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(text(pageOf(result), 'main')).not.toContain('Flood Risk Team')
      expect(calledPaths()).toEqual([`${TEAM_PATH}/environments/infradev`])
    })

    test('is a 404 when the backend says the environment is not available', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: reply(404, {
          code: 'environment-not-available'
        })
      })

      expect((await get(INFRADEV_URL)).statusCode).toBe(statusCodes.notFound)
    })

    test('says it could not read the environment when the backend is unavailable', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { statusCode, result } = await get(INFRADEV_URL)

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(pageOf(result), 'main')).toContain(
        'We could not read this environment just now'
      )
    })

    test('still shows the page when the client secret cannot be read', async () => {
      backend({
        'GET /v1/credentials': reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode, result } = await get(INFRADEV_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(text(pageOf(result), '[data-testid="secret-row"]')).toContain(
        'We could not check this just now.'
      )
    })

    test('has a status fragment of the changes, models and limits', async () => {
      backend({
        [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
          open: [openOperation()]
        })
      })

      const { statusCode, headers, result } = await get(
        `${INFRADEV_URL}?fragment=status`
      )
      const $ = pageOf(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(headers['cache-control']).toBe('no-store')
      expect($('[data-in-progress]').attr('data-in-progress')).toBe('true')
      expect($('[data-testid="change-in-progress"]')).toHaveLength(1)
      expect($('[data-testid="model-row"]')).toHaveLength(2)
    })

    describe('what each state of a model and of the client secret says', () => {
      function modelsIn(states) {
        return states.map(([id, modelSlug, status, extra]) => ({
          _id: id,
          teamId: 'team-1',
          modelSlug,
          environment: 'infradev',
          status,
          ...extra
        }))
      }

      test('says what each state of a model is, with a way to follow one being set up and none to remove one that is changing', async () => {
        backend({
          [`GET ${TEAM_PATH}/environments/infradev`]: detail({
            models: modelsIn([
              ['d-1', 'gpt-4o', 'deploying'],
              ['d-2', 'gpt-4-1-nano', 'queued'],
              ['d-3', 'gpt-5-mini', 'removing']
            ])
          })
        })

        const { result } = await get(INFRADEV_URL)
        const $ = pageOf(result)

        expect(
          $('[data-testid="model-row"] .govuk-tag')
            .map((_, tag) => $(tag).text().trim())
            .get()
        ).toEqual(['Setting up', 'Waiting', 'Removing'])
        expect(result).toContain('govuk-tag--yellow')
        expect(result).toContain(
          'href="/connect/team/request/flood-risk-team/d-1"'
        )
        expect(result).not.toContain('/request/flood-risk-team/d-3')
        expect(result).not.toContain('/models/d-1/remove')
        expect(result).not.toContain('/models/d-3/remove')
      })

      test('says a model could not be set up, with a link to see what happened and no way to remove it', async () => {
        backend({
          [`GET ${TEAM_PATH}/environments/infradev`]: detail({
            models: modelsIn([['d-4', 'gpt-4o', 'checks-failed']])
          })
        })

        const { result } = await get(INFRADEV_URL)

        expect(result).toContain('Setup failed')
        expect(result).toContain('govuk-tag--red')
        expect(result).toContain('See what happened')
        expect(result).toContain(
          'href="/connect/team/request/flood-risk-team/d-4"'
        )
        expect(result).not.toContain('/models/d-4/remove')
      })

      test('a removal that failed returns the model as ready, with the reason', async () => {
        backend({
          [`GET ${TEAM_PATH}/environments/infradev`]: detail({
            models: modelsIn([
              [
                'd-1',
                'gpt-4o',
                'active',
                { failureReason: 'The change was rejected.' }
              ]
            ])
          })
        })

        const { result } = await get(INFRADEV_URL)

        expect(result).toContain('Ready to use')
        expect(result).toContain('The change was rejected.')
      })

      test('names a model by its slug when the catalogue cannot be read', async () => {
        backend({
          'GET /v1/models': reply(502, { code: 'upstream-unavailable' })
        })

        const { statusCode, result } = await get(INFRADEV_URL)

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toContain('gpt-4o')
      })

      test('shows no date for a client secret that does not say when it expires', async () => {
        backend({
          'GET /v1/credentials': {
            items: [{ ...teamCredential, expiresAt: null }]
          }
        })

        const { result } = await get(INFRADEV_URL)

        expect(result).not.toContain('Expires')
        expect(result).toContain(
          `href="/teams/${sampleTeam.slug}/client-secrets/cred-1/view"`
        )
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
              revokedAt: '2026-11-11T09:00:00.000Z'
            }
          ],
          'Revoked'
        ],
        ['none yet', [], 'Ready once a model has been set up.']
      ])(
        'says where the client secret is with %s, and offers nothing to do with it',
        async (_name, credentials, expected) => {
          backend({ 'GET /v1/credentials': { items: credentials } })

          const { result } = await get(INFRADEV_URL)

          expect(result).toContain(expected)
          expect(result).not.toContain('/client-secrets/')
        }
      )

      test('reads the credentials only after the environment, which is what grants a model that just turned active its team secret', async () => {
        let granted = false

        backend({
          [`GET ${TEAM_PATH}/environments/infradev`]: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20))
            granted = true

            return detail()
          },
          'GET /v1/credentials': () => ({
            items: granted ? [teamCredential] : []
          })
        })

        const { result } = await get(INFRADEV_URL)

        expect(result).toContain('Expires 19 October 2027')
        expect(result).not.toContain('Ready once a model has been set up.')
      })

      test('hides models that were removed, and the client secret with them, once the last one has gone', async () => {
        backend({
          [`GET ${TEAM_PATH}/environments/infradev`]: detail({ models: [] })
        })

        const $ = pageOf((await get(INFRADEV_URL)).result)

        expect($('[data-testid="no-models"]').text()).toContain(
          'No models in Infradev'
        )
        expect($('[data-testid="secret-row"]')).toHaveLength(0)
      })
    })

    describe('the progress of a change', () => {
      test('is a fault, not a page, when the backend refuses for a reason the page cannot explain', async () => {
        backend({
          [`GET ${TEAM_PATH}/environments/infradev`]: reply(403, {
            code: 'forbidden'
          })
        })

        expect((await get(INFRADEV_URL)).statusCode).toBe(
          statusCodes.internalServerError
        )
      })

      test('still shows the overview, without Change team, when the list of the person’s teams cannot be read', async () => {
        backend({
          'GET /v1/teams': reply(502, { code: 'upstream-unavailable' })
        })

        const { statusCode, result } = await get(OVERVIEW_URL)

        expect(statusCode).toBe(statusCodes.ok)
        expect(pageOf(result)('a[data-testid="change-team"]')).toHaveLength(0)
      })

      test('masks an email-shaped name of whoever asked, for a Member looking at an open change', async () => {
        backend(
          {
            [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
              open: [
                openOperation({
                  requestedBy: { name: 'jo.bloggs@defra.gov.uk' }
                })
              ]
            })
          },
          'user'
        )

        const { result } = await get(INFRADEV_URL)

        expect(result).toContain('Asked for by j********@defra.gov.uk at 10:41')
        expect(result).not.toContain('jo.bloggs@defra.gov.uk')
      })

      test('says the changes could not be read on an environment’s page, and still shows its models', async () => {
        backend({
          [`GET ${TEAM_PATH}/operations`]: reply(502, {
            code: 'upstream-unavailable'
          })
        })

        const $ = pageOf((await get(INFRADEV_URL)).result)

        expect($('[data-testid="changes-unavailable"]').text()).toContain(
          'We could not read the changes just now'
        )
        expect($('[data-testid="model-row"]')).toHaveLength(2)
      })

      test('shows a change that failed while still open as failed, with its reason and the run to follow', async () => {
        backend({
          [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
            open: [
              openOperation({
                steps: failedOperation().steps,
                failureReason: 'The apply is being tried again.',
                runUrl:
                  'https://github.com/DEFRA/ai-platform-tenants/actions/runs/7'
              })
            ]
          })
        })

        const $ = pageOf((await get(INFRADEV_URL)).result)
        const change = $('[data-testid="change-in-progress"]')

        expect(
          change
            .find('.app-step-list__label')
            .map((_, label) => $(label).text().replace(/\s+/g, ' ').trim())
            .get()
        ).toEqual([
          'Done: Request received',
          'Failed: Checks passed',
          'Not started: Deploying',
          'Not started: Deployed',
          'Not started: Ready to use'
        ])
        expect(change.find('[data-testid="failure"]').text()).toContain(
          'The apply is being tried again.'
        )
        expect(change.find('[data-testid="failure"] a').attr('href')).toBe(
          'https://github.com/DEFRA/ai-platform-tenants/actions/runs/7'
        )
      })

      test('a run link that is not https is not shown', async () => {
        backend({
          [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
            recent: [failedOperation({ runUrl: 'javascript:alert(1)' })]
          })
        })

        const $ = pageOf((await get(INFRADEV_URL)).result)

        expect($('[data-testid="failure"] a')).toHaveLength(0)
      })

      test('gives a person without script a Check progress link while a change is open, and none when nothing is', async () => {
        backend({
          [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
            open: [openOperation()]
          })
        })

        const busy = pageOf((await get(INFRADEV_URL)).result)

        expect(busy('a[data-testid="check-progress"]').text()).toBe(
          'Check progress'
        )
        expect(busy('a[data-testid="check-progress"]').attr('href')).toBe(
          INFRADEV_URL
        )

        backend()
        const idle = pageOf((await get(INFRADEV_URL)).result)

        expect(idle('[data-testid="check-progress"]')).toHaveLength(0)
        expect(idle('[data-in-progress]').attr('data-in-progress')).toBe(
          'false'
        )
      })
    })

    describe('the status fragment as a cache', () => {
      const FRAGMENT_URL = `${INFRADEV_URL}?fragment=status`

      test('is only the status, not the page, with an ETag and no-store', async () => {
        backend()

        const { statusCode, result, headers } = await get(FRAGMENT_URL)

        expect(statusCode).toBe(statusCodes.ok)
        expect(headers['content-type']).toContain('text/html')
        expect(headers['cache-control']).toBe('no-store')
        expect(headers.etag).toMatch(/^"[^"]+"$/)
        expect(result).not.toContain('<html')
        expect(result).not.toContain('govuk-service-navigation')
      })

      test('answers 304, with no-store, when the person already has this version', async () => {
        backend()
        const first = await get(FRAGMENT_URL)

        const second = await get(FRAGMENT_URL, {
          'if-none-match': first.headers.etag
        })

        expect(second.statusCode).toBe(statusCodes.notModified)
        expect(second.headers['cache-control']).toBe('no-store')
      })

      test('answers 200 with a new ETag when a change has moved on', async () => {
        backend({
          [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
            open: [openOperation()]
          })
        })
        const first = await get(FRAGMENT_URL)

        backend({
          [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
            recent: [doneOperation()]
          })
        })
        const second = await get(FRAGMENT_URL, {
          'if-none-match': first.headers.etag
        })

        expect(second.statusCode).toBe(statusCodes.ok)
        expect(second.headers.etag).not.toBe(first.headers.etag)
        expect(
          pageOf(second.result)('[data-in-progress]').attr('data-in-progress')
        ).toBe('false')
      })

      test('is the whole page for any other value of fragment', async () => {
        backend()

        const { result, headers } = await get(`${INFRADEV_URL}?fragment=other`)

        expect(result).toContain('<html')
        expect(headers.etag).toBeUndefined()
      })

      test('redirects to sign in when signed out', async () => {
        const { statusCode } = await server.inject({
          method: 'GET',
          url: FRAGMENT_URL
        })

        expect(statusCode).toBe(statusCodes.found)
      })

      test('is not available when the environment could not be read, so the page keeps what it has', async () => {
        backend({
          [`GET ${TEAM_PATH}/environments/infradev`]: reply(502, {
            code: 'upstream-unavailable'
          })
        })

        const { statusCode, headers } = await get(FRAGMENT_URL)

        expect(statusCode).toBe(statusCodes.serviceUnavailable)
        expect(headers['cache-control']).toBe('no-store')
      })
    })
  })
})

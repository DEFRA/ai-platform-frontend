import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  signInViaOidc,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'

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

const USAGE = (days = 30) =>
  `/v1/admin/environments/infradev/usage?days=${days}`

function usage(overrides = {}) {
  return {
    environment: 'infradev',
    source: 'log-analytics',
    period: { from: '2026-10-28', to: '2026-11-27', days: 30 },
    costBasis: { estimate: true, currency: 'USD', priceVersion: 'v1' },
    teams: [
      {
        teamId: 'team-1',
        slug: 'flood',
        name: 'Flood Risk Team',
        serviceCode: 'ABC',
        requests: 1500,
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500000,
        estimatedCost: 12.25
      },
      {
        teamId: 'team-2',
        slug: 'quiet',
        name: 'Quiet Team',
        serviceCode: null,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0
      }
    ],
    otherApis: [
      {
        apiId: 'research',
        requests: 9,
        totalTokens: 900,
        estimatedCost: null
      }
    ],
    ...overrides
  }
}

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('#admin usage', () => {
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
    cookies = await signInViaOidc(server, fetchMock, { isPlatformAdmin: true })
  })

  function get(url = '/admin/usage', jar = cookies) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(jar) }
    })
  }

  function adminCalls() {
    return fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter(({ pathname }) => pathname.startsWith('/v1/admin'))
      .map(({ pathname, search }) => `${pathname}${search}`)
  }

  test('redirects a signed out person to sign in, and asks the backend nothing', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/admin/usage'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toContain('/sign-in')
    expect(adminCalls()).toEqual([])
  })

  test('lists every team with its figures, and the APIs no team owns', async () => {
    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage() })

    const response = await get()
    const $ = load(response.result)

    expect(response.statusCode).toBe(statusCodes.ok)
    expect($('h1').text()).toContain('Usage')
    expect(text($, '[data-testid="usage-period"]')).toBe(
      'Infradev, 28 October 2026 to 26 November 2026.'
    )

    const rows = $('[data-testid="usage-by-team"] tbody tr')

    expect(rows).toHaveLength(2)
    expect(text($, rows.first())).toContain('Flood Risk Team')
    expect(text($, rows.first())).toContain('ABC')
    expect(text($, rows.first())).toContain('1,500')
    expect(text($, rows.first())).toContain('US$12.25')
    expect(text($, rows.eq(1))).toContain('Not set')
    expect($(rows.first()).find('a').attr('href')).toBe('/admin/teams/team-1')
    expect(text($, '[data-testid="usage-other-apis"]')).toContain('research')
    expect(text($, '[data-testid="usage-other-apis"]')).toContain(
      'Not available'
    )
  })

  test('shows the figures across every team, with Personal access on its own', async () => {
    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage() })

    const $ = load((await get()).result)
    const cards = $('[data-testid="usage-cards"] .app-stat-card')
      .map((_, card) => text($, $(card)))
      .get()

    expect(cards).toEqual([
      '1.5m Tokens used by teams',
      'US$12.25 Estimated cost of teams',
      '1,500 Requests by teams',
      '1 of 2 Teams with use',
      '900 Personal access tokens 9 requests, met by the Research cost centre'
    ])
  })

  test('says the cost of teams is not available when any team has no price', async () => {
    const teams = usage().teams.map((team, index) =>
      index === 0 ? { ...team, estimatedCost: null } : team
    )

    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage({ teams }) })

    const $ = load((await get()).result)

    expect(text($, '[data-testid="usage-cards"]')).toContain(
      'Not available Estimated cost of teams'
    )
  })

  test('has a ring of tokens by team and each team’s share in the table', async () => {
    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage() })

    const $ = load((await get()).result)

    expect($('[data-testid="usage-team-ring"] svg.app-donut')).toHaveLength(1)
    expect(text($, '[data-testid="usage-team-ring"] li')).toContain(
      'Flood Risk Team'
    )
    expect(
      text($, '[data-testid="usage-by-team"] tbody tr:first-child')
    ).toContain('100%')
    expect(
      $('[data-testid="usage-by-team"] tbody tr')
        .eq(1)
        .find('meter')
        .attr('value')
    ).toBe('0')
  })

  test('groups the teams past the sixth colour into Other teams', async () => {
    const teams = Array.from({ length: 8 }, (_, index) => ({
      teamId: `team-${index}`,
      slug: `team-${index}`,
      name: `Team ${index}`,
      serviceCode: null,
      requests: 1,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 1000 - index,
      estimatedCost: 1
    }))

    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage({ teams }) })

    const $ = load((await get()).result)
    const legend = $('[data-testid="usage-team-ring"] li')

    expect(legend).toHaveLength(6)
    expect(text($, legend.last())).toContain('Other teams')
  })

  test('has no ring when no team has used any tokens', async () => {
    mockApi(fetchMock, {
      [`GET ${USAGE()}`]: usage({ teams: usage().teams.slice(1) })
    })

    expect(
      load((await get()).result)('[data-testid="usage-team-ring"]')
    ).toHaveLength(0)
  })

  describe('the teams table, 10 to a page', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      teamId: `team-${index}`,
      slug: `team-${index}`,
      name: `Team ${String(index).padStart(2, '0')}`,
      serviceCode: null,
      requests: 1,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 1000 - index,
      estimatedCost: 1
    }))

    function rowNames($) {
      return $('[data-testid="usage-by-team"] tbody th')
        .map((_, th) => $(th).text().trim())
        .get()
    }

    test('shows the first 10 teams, says which, and links to the next page', async () => {
      mockApi(fetchMock, { [`GET ${USAGE()}`]: usage({ teams: many }) })

      const $ = load((await get()).result)

      expect(rowNames($)).toHaveLength(10)
      expect(text($, '[data-testid="table-pagination-summary"]')).toBe(
        'Showing 1 to 10 of 12 teams'
      )
      expect($('.govuk-pagination__next a').attr('href')).toBe(
        '/admin/usage?environment=infradev&days=30&page=2'
      )
    })

    test('shows the rest on page 2, and keeps the environment and period in its links', async () => {
      mockApi(fetchMock, { [`GET ${USAGE(7)}`]: usage({ teams: many }) })

      const $ = load((await get('/admin/usage?days=7&page=2')).result)

      expect(rowNames($)).toEqual(['Team 10', 'Team 11'])
      expect($('.govuk-pagination__prev a').attr('href')).toBe(
        '/admin/usage?environment=infradev&days=7'
      )
    })

    test('keeps the cards and the ring to every team, not the page', async () => {
      mockApi(fetchMock, { [`GET ${USAGE()}`]: usage({ teams: many }) })

      const $ = load((await get('/admin/usage?page=2')).result)

      expect(text($, '[data-testid="usage-cards"]')).toContain(
        '12 of 12 Teams with use'
      )
    })

    test('has no page links when one page holds every team', async () => {
      mockApi(fetchMock, { [`GET ${USAGE()}`]: usage() })

      const $ = load((await get()).result)

      expect($('[data-testid="table-pagination-summary"]')).toHaveLength(0)
    })
  })

  test('offers the period as a titled drop-down that keeps the environment', async () => {
    mockApi(fetchMock, { [`GET ${USAGE(90)}`]: usage() })

    const $ = load((await get('/admin/usage?days=90')).result)
    const form = $('[data-testid="filter-bar"]')

    expect(form.attr('action')).toBe('/admin/usage')
    expect(form.find('label[for="days"]').text().trim()).toBe('Period')
    expect(form.find('option[selected]').text()).toBe('Last 90 days')
    expect(form.find('input[name="environment"]').attr('value')).toBe(
      'infradev'
    )
  })

  test('shows Usage as the current Admin tab and always calls the cost an estimate', async () => {
    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage() })

    const $ = load((await get()).result)

    expect($('[aria-label="Admin"] [aria-current="page"]').text()).toBe('Usage')
    expect(text($, '[data-testid="usage-cost-notice"]')).toContain('estimates')
  })

  test('says so when the figures are examples', async () => {
    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage({ source: 'mock' }) })

    expect(
      load((await get()).result)('[data-testid="usage-mock-notice"]')
    ).toHaveLength(1)
  })

  test('says there are no teams, and shows no Other APIs, when there is nothing', async () => {
    mockApi(fetchMock, {
      [`GET ${USAGE()}`]: usage({ teams: [], otherApis: [] })
    })

    const $ = load((await get()).result)

    expect($('[data-testid="usage-no-teams"]')).toHaveLength(1)
    expect($('[data-testid="usage-other-apis"]')).toHaveLength(0)
  })

  test.each([7, 90])('asks the backend for %i days', async (days) => {
    mockApi(fetchMock, { [`GET ${USAGE(days)}`]: usage() })

    await get(`/admin/usage?days=${days}`)

    expect(adminCalls()).toEqual([USAGE(days)])
  })

  test('asks for 30 days when the address asks for anything else', async () => {
    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage() })

    await get('/admin/usage?days=1%3Bdrop')

    expect(adminCalls()).toEqual([USAGE()])
  })

  test('says usage is not available for an environment with no source', async () => {
    mockApi(fetchMock, {
      [`GET ${USAGE()}`]: reply(404, { code: 'usage-not-available' })
    })

    const response = await get()

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(
      text(load(response.result), '[data-testid="usage-not-available"]')
    ).toContain('We cannot show usage for Infradev yet')
  })

  test('says the environment is not found when the backend does not offer it, not that a team is missing', async () => {
    mockApi(fetchMock, {
      [`GET ${USAGE()}`]: reply(404, { code: 'environment-not-available' })
    })

    const response = await get()
    const $ = load(response.result)

    expect(response.statusCode).toBe(statusCodes.notFound)
    expect($('h1').text()).toBe('Environment not found')
  })

  test('keeps every table in a labelled, focusable region that scrolls on its own', async () => {
    mockApi(fetchMock, { [`GET ${USAGE()}`]: usage() })

    const $ = load((await get()).result)

    for (const testId of ['usage-by-team', 'usage-other-apis']) {
      const region = $(`[data-testid="${testId}"]`).closest('.app-table-scroll')

      expect(region).toHaveLength(1)
      expect(region.attr('role')).toBe('region')
      expect(region.attr('tabindex')).toBe('0')
      expect(region.attr('aria-label')).toBeTruthy()
    }
  })

  test('is not found for an environment this instance does not know, and asks nothing', async () => {
    const response = await get('/admin/usage?environment=nowhere')

    expect(response.statusCode).toBe(statusCodes.notFound)
    expect(adminCalls()).toEqual([])
  })

  test('shows the 403 page for a person the backend says is not a Platform Admin', async () => {
    mockApi(fetchMock, {
      [`GET ${USAGE()}`]: reply(403, { code: 'platform-admin-required' })
    })

    const response = await get()

    expect(response.statusCode).toBe(statusCodes.forbidden)
    expect(load(response.result)('h1').text()).toBe(
      'Only a Platform Admin can use this page'
    )
  })

  test('shows the unavailable page for a failing backend, with Try again to the same address', async () => {
    mockApi(fetchMock, {
      [`GET ${USAGE(7)}`]: reply(502, { code: 'upstream-unavailable' })
    })

    const response = await get('/admin/usage?days=7')
    const $ = load(response.result)

    expect(response.statusCode).toBe(statusCodes.badGateway)
    expect($('h1').text()).toBe('We could not load this page')
    expect($('main .govuk-button').attr('href')).toBe('/admin/usage?days=7')
  })
})

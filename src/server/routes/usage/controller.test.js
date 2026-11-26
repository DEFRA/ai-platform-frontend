import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import { TEAM_PATH } from '#/test-helpers/environments-helpers.js'
import {
  signInViaOidc,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import { teamWithMembers } from '#/test-helpers/team-connect-helpers.js'

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

const SLUG = 'flood-risk-team'
const OVERVIEW_PATH = `${TEAM_PATH}/usage`

function zeroTokens() {
  return { requests: 0, promptTokens: 0, completionTokens: 0, tokens: 0 }
}

export function overview(overrides = {}) {
  return {
    teamId: 'team-1',
    teamName: 'Flood Risk Team',
    teamSlug: SLUG,
    source: 'log-analytics',
    costBasis: { estimate: true, currency: 'USD', priceVersion: 'v1' },
    carbonBasis: { enabled: false },
    window: { from: '2026-06-01', to: '2026-11-24' },
    month: { key: '2026-11', daysElapsed: 23, daysInMonth: 30 },
    months: [
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11'
    ].map((key) => ({
      key,
      requests: 10,
      tokens: 1_000_000,
      cost: 5,
      carbonKg: null
    })),
    current: {
      totals: {
        requests: 1234,
        promptTokens: 400_000_000,
        completionTokens: 39_100_000,
        tokens: 439_100_000,
        cost: 250,
        carbonKg: null,
        electricityKwh: null,
        costPerMillionTokens: 0.57,
        carbonGramsPerMillionTokens: null
      },
      forecast: { tokens: 572_000_000, cost: 328, carbonKg: null },
      byEnvironment: [
        {
          environment: 'infradev',
          ...zeroTokens(),
          tokens: 339_000_000,
          share: 0.77,
          cost: 194,
          carbonKg: null
        },
        {
          environment: 'qa',
          ...zeroTokens(),
          tokens: 100_100_000,
          share: 0.23,
          cost: 56,
          carbonKg: null
        }
      ],
      byModel: [
        {
          modelSlug: 'gpt-4o',
          requests: 14,
          promptTokens: 300_000_000,
          completionTokens: 30_000_000,
          tokens: 330_000_000,
          share: 0.75,
          price: { inputPerMillion: 2.5, outputPerMillion: 10 },
          cost: 200,
          carbonKg: null
        },
        {
          modelSlug: 'mystery',
          requests: 3,
          promptTokens: 100_000_000,
          completionTokens: 9_100_000,
          tokens: 109_100_000,
          share: 0.25,
          price: null,
          cost: 50,
          carbonKg: null
        }
      ],
      byDay: [
        {
          day: '2026-11-01',
          tokens: 10_000_000,
          byEnvironment: { infradev: 8_000_000, qa: 2_000_000 }
        },
        { day: '2026-11-02', tokens: 0, byEnvironment: {} }
      ]
    },
    unavailable: [],
    unpricedModels: [],
    attention: [],
    budget: null,
    ...overrides
  }
}

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('#usage section', () => {
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

  function backend(routes = {}, role = 'user') {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${OVERVIEW_PATH}`]: overview(),
      ...routes
    })
  }

  function get(url) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
    })
  }

  describe('the Usage menu', () => {
    test('opens the first team when none has been looked at', async () => {
      backend({
        'GET /v1/teams': {
          items: [
            { slug: 'a-team', name: 'A Team' },
            { slug: SLUG, name: 'Flood Risk Team' }
          ]
        }
      })

      const response = await get('/usage')

      expect(response.statusCode).toBe(statusCodes.found)
      expect(response.headers.location).toBe('/usage/a-team')
    })

    test('opens the team chosen in the drop-down, on the tab the person was on', async () => {
      backend({
        'GET /v1/teams': {
          items: [
            { slug: 'a-team', name: 'A Team' },
            { slug: 'b-team', name: 'B Team' }
          ]
        }
      })

      const costs = await get('/usage?team=b-team&tab=costs')
      const carbon = await get('/usage?team=b-team&tab=carbon')
      const overview = await get('/usage?team=b-team&tab=overview')

      expect(costs.headers.location).toBe('/usage/b-team/costs')
      expect(carbon.headers.location).toBe('/usage/b-team/carbon')
      expect(overview.headers.location).toBe('/usage/b-team')
    })

    test('ignores a team that is not the person’s, and a tab that does not exist', async () => {
      backend({
        'GET /v1/teams': { items: [{ slug: 'a-team', name: 'A Team' }] }
      })

      const response = await get('/usage?team=someone-elses&tab=constructor')

      expect(response.headers.location).toBe('/usage/a-team')
    })

    test('goes back to the team last looked at', async () => {
      backend({
        'GET /v1/teams': {
          items: [
            { slug: 'a-team', name: 'A Team' },
            { slug: SLUG, name: 'Flood Risk Team' }
          ]
        }
      })

      await get(`/usage/${SLUG}`)

      expect((await get('/usage')).headers.location).toBe(`/usage/${SLUG}`)
    })

    test('says so when the person is in no team, and points to Personal access', async () => {
      backend({ 'GET /v1/teams': { items: [] } })

      const $ = load((await get('/usage')).result)

      expect(text($, '[data-testid="usage-no-teams"]')).toContain(
        'not a member of a team'
      )
      expect($('[data-testid="usage-no-teams"] a').attr('href')).toBe('/manage')
    })
  })

  describe('the team drop-down', () => {
    const TEAMS = {
      'GET /v1/teams': {
        items: [
          { slug: SLUG, name: 'Flood Risk Team' },
          { slug: 'b-team', name: 'B Team' }
        ]
      }
    }

    test('is a titled drop-down of the person’s teams, with the current one selected', async () => {
      backend(TEAMS)

      const $ = load((await get(`/usage/${SLUG}`)).result)
      const form = $('[data-testid="filter-bar"]')

      expect(form.attr('action')).toBe('/usage')
      expect(form.attr('data-auto-submit')).toBeDefined()
      expect(form.find('label[for="team"]').text().trim()).toBe('Team')
      expect(
        form
          .find('option')
          .map((_, option) => $(option).attr('value'))
          .get()
      ).toEqual([SLUG, 'b-team'])
      expect(form.find('option[selected]').attr('value')).toBe(SLUG)
    })

    test.each([
      ['', 'overview'],
      ['/costs', 'costs']
    ])('stays on the tab: %s asks for %s', async (path, tab) => {
      backend(TEAMS)

      const $ = load((await get(`/usage/${SLUG}${path}`)).result)

      expect(
        $('[data-testid="filter-bar"] input[name="tab"]').attr('value')
      ).toBe(tab)
    })

    test('is left out for a person with one team', async () => {
      backend({
        'GET /v1/teams': { items: [{ slug: SLUG, name: 'Flood Risk Team' }] }
      })

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect($('[data-testid="filter-bar"]')).toHaveLength(0)
    })

    test('leaves the page as it was when the teams cannot be read', async () => {
      backend({ 'GET /v1/teams': reply(500, { code: 'internal' }) })

      const response = await get(`/usage/${SLUG}`)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(load(response.result)('[data-testid="filter-bar"]')).toHaveLength(
        0
      )
    })
  })

  describe('Overview', () => {
    test('shows the figures, the tabs and the notices a member needs', async () => {
      backend()

      const response = await get(`/usage/${SLUG}`)
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect($('h1').text().trim()).toBe('Usage')
      expect(text($, '[data-testid="usage-period"]')).toBe(
        '1 to 23 November 2026. Costs are estimates.'
      )
      expect(text($, '[data-testid="usage-cards"]')).toContain('439m')
      expect(text($, '[data-testid="usage-cards"]')).toContain('US$250')
      expect(text($, '[data-testid="usage-cards"]')).toContain(
        'Forecast US$328 for November'
      )
      expect(
        $('[aria-label="Usage"] a')
          .map((_, a) => $(a).text().trim())
          .get()
      ).toEqual(['Overview', 'Costs'])
      expect(
        $('[aria-label="Usage"] [aria-current="page"]').text().trim()
      ).toBe('Overview')
    })

    test('shows no Carbon tab or carbon card while carbon is off', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect(text($, '[data-testid="usage-cards"]')).not.toContain('Carbon')
      expect(text($, '[aria-label="Usage"]')).not.toContain('Carbon')
    })

    test('shows the Carbon tab and card once carbon is on', async () => {
      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          carbonBasis: { enabled: true },
          current: {
            ...overview().current,
            totals: { ...overview().current.totals, carbonKg: 11.7 },
            forecast: { tokens: 1, cost: 1, carbonKg: 15.3 }
          }
        })
      })

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect(text($, '[data-testid="usage-cards"]')).toContain('11.7 kg')
      expect(
        $('[aria-label="Usage"] a')
          .map((_, a) => $(a).text().trim())
          .get()
      ).toEqual(['Overview', 'Costs', 'Carbon'])
    })

    test('says there is no budget yet, rather than inventing one', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect(text($, '[data-testid="usage-no-budget"]')).toContain(
        'not set up yet'
      )
    })

    test('has a chart of tokens each day and the same figures as a table', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect($('[data-testid="usage-day-chart"] svg[role="img"]')).toHaveLength(
        1
      )
      expect($('[data-testid="usage-day-table"] tbody tr')).toHaveLength(2)
      expect($('[data-testid="usage-day-chart"] [style]')).toHaveLength(0)
    })

    test('has a column for each environment in the table of tokens each day', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}`)).result)
      const headings = $('[data-testid="usage-day-table"] thead th')
        .map((_, th) => $(th).text().trim())
        .get()
      const firstDay = $('[data-testid="usage-day-table"] tbody tr')
        .first()
        .find('th, td')
        .map((_, cell) => $(cell).text().trim())
        .get()

      expect(headings).toEqual(['Day', 'Infradev', 'QA', 'All environments'])
      expect(firstDay).toEqual([
        '1 Nov',
        '8,000,000',
        '2,000,000',
        '10,000,000'
      ])
    })

    test('keeps each usage table in a labelled keyboard-scrollable region', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}`)).result)

      for (const [testId, label] of [
        ['usage-day-table', 'Tokens each day'],
        ['usage-by-model', 'Usage by model'],
        ['usage-by-environment', 'Usage by environment']
      ]) {
        const region = $(`[data-testid="${testId}"]`).closest(
          '.app-table-scroll'
        )

        expect(region.attr('role')).toBe('region')
        expect(region.attr('tabindex')).toBe('0')
        expect(region.attr('aria-label')).toBe(label)
      }
    })

    test('shares tokens by model and by environment, with a link to each environment', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect($('[data-testid="usage-by-model"] tbody tr')).toHaveLength(2)
      expect(
        $('[data-testid="usage-by-environment"] a')
          .map((_, a) => $(a).attr('href'))
          .get()
      ).toEqual([
        `/environments/${SLUG}/infradev/usage`,
        `/environments/${SLUG}/qa/usage`
      ])
    })

    test('lists what needs attention, with a link to that environment’s page', async () => {
      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          attention: [
            { kind: 'calls-refused', environment: 'qa', count: 37, days: 7 }
          ]
        })
      })

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect(text($, '[data-testid="usage-attention"]')).toContain(
        'QA had 37 calls refused in the last 7 days'
      )
      expect($('[data-testid="usage-attention"] a').attr('href')).toBe(
        `/environments/${SLUG}/qa`
      )
    })

    test('says so when the figures are examples, and which environments have none', async () => {
      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          source: 'mock',
          unavailable: ['qa']
        })
      })

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect($('[data-testid="usage-mock-notice"]')).toHaveLength(1)
      expect(text($, '[data-testid="usage-unavailable"]')).toContain('QA')
    })

    test('says there were no requests, and shows no tables, for a quiet team', async () => {
      const base = overview()

      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          current: {
            ...base.current,
            totals: { ...base.current.totals, requests: 0, tokens: 0, cost: 0 }
          }
        })
      })

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect($('[data-testid="usage-empty"]')).toHaveLength(1)
      expect($('[data-testid="usage-by-model"]')).toHaveLength(0)
    })

    test('names a model with no price', async () => {
      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({ unpricedModels: ['mystery'] })
      })

      const $ = load((await get(`/usage/${SLUG}`)).result)

      expect(text($, '[data-testid="usage-unpriced"]')).toContain('mystery')
    })

    test.each([
      ['Overview', `/usage/${SLUG}`],
      ['Costs', `/usage/${SLUG}/costs`]
    ])(
      'limits the %s unpriced notice to periods with unpriced usage',
      async (_, url) => {
        const base = overview()

        backend({
          [`GET ${OVERVIEW_PATH}`]: overview({
            unpricedModels: ['mystery'],
            months: base.months.map((month, index) =>
              index === 0 ? { ...month, cost: null } : month
            ),
            current: {
              ...base.current,
              byModel: [base.current.byModel[0]]
            }
          })
        })

        const $ = load((await get(url)).result)

        expect(text($, '[data-testid="usage-unpriced"]')).toBe(
          'Estimated costs are unavailable only for periods that include usage from mystery without a price.'
        )
        expect(text($, '[data-testid="usage-cards"]')).toContain('US$250')
      }
    )
  })

  describe('Costs', () => {
    test('shows the cost, the forecast, the cost for a million tokens and the months', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}/costs`)).result)

      expect($('h1').text().trim()).toBe('Costs')
      expect(text($, '[data-testid="usage-cards"]')).toContain('US$250')
      expect(text($, '[data-testid="usage-cards"]')).toContain('US$328')
      expect(text($, '[data-testid="usage-cards"]')).toContain('US$0.57')
      expect($('[data-testid="costs-month-table"] tbody tr')).toHaveLength(6)
      expect(text($, '[data-testid="usage-period"]')).toContain(
        'Every cost is an estimate.'
      )
    })

    test('shows unavailable months separately from a zero estimate', async () => {
      const base = overview()

      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          months: base.months.map((month, index) =>
            index === 0
              ? { ...month, cost: null }
              : index === 1
                ? { ...month, cost: 0 }
                : month
          )
        })
      })

      const $ = load((await get(`/usage/${SLUG}/costs`)).result)
      const monthlyCosts = $('[data-testid="costs-month-table"] tbody td')
        .map((_, cell) => $(cell).text().trim())
        .get()

      expect($('[data-testid="costs-month-chart"] svg')).toHaveLength(0)
      expect(
        text($, '[data-testid="costs-month-chart-unavailable"]')
      ).toContain('not available for one or more months')
      expect(monthlyCosts.slice(0, 2)).toEqual(['Not available', 'US$0.00'])
    })

    test('splits the cost by environment and by model, with the example prices', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}/costs`)).result)

      expect($('[data-testid="costs-by-environment"] tbody tr')).toHaveLength(2)
      expect($('[data-testid="costs-environment-donut"] svg')).toHaveLength(1)
      expect(text($, '[data-testid="costs-by-model"]')).toContain(
        'US$2.50 and US$10.00'
      )
      expect(text($, '[data-testid="costs-by-model"]')).toContain(
        'No price yet'
      )
    })

    test('says how the cost is estimated', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}/costs`)).result)

      expect(text($, '[data-testid="costs-method"]')).toContain(
        'indicative price'
      )
      expect(text($, '[data-testid="costs-method"]')).toContain('USD')
    })

    test('shows no split of a total that leaves a model out, and does not invent shares', async () => {
      const base = overview()

      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          unpricedModels: ['mystery'],
          current: {
            ...base.current,
            totals: { ...base.current.totals, cost: null }
          }
        })
      })

      const $ = load((await get(`/usage/${SLUG}/costs`)).result)

      expect($('[data-testid="costs-environment-donut"] svg')).toHaveLength(0)
      expect(text($, '[data-testid="costs-donut-unavailable"]')).toContain(
        'not available'
      )
      expect(text($, '[data-testid="costs-by-environment"]')).not.toContain('%')
      expect(text($, '[data-testid="costs-by-model"] tfoot')).toContain(
        'Not available'
      )
      expect(text($, '[data-testid="costs-by-model"] tfoot')).not.toContain(
        '100%'
      )
    })
  })

  describe('the costs export', () => {
    test('gives an admin a CSV of the month, one row for each model', async () => {
      backend({}, 'admin')

      const response = await get(`/usage/${SLUG}/costs.csv`)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(response.headers['content-type']).toContain('text/csv')
      expect(response.headers['content-disposition']).toContain(
        'costs-2026-11.csv'
      )
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.result.split('\r\n')).toEqual([
        'Month,Model,Requests,Input tokens,Output tokens,Estimated cost (USD)',
        '2026-11,gpt-4o,14,300000000,30000000,200.00',
        '2026-11,mystery,3,100000000,9100000,50.00',
        ''
      ])
    })

    test('refuses a member who is not an admin, and reads no usage', async () => {
      backend({}, 'user')

      const response = await get(`/usage/${SLUG}/costs.csv`)

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(
        fetchMock.mock.calls.some(([request]) =>
          String(request.url ?? request).includes('/usage')
        )
      ).toBe(false)
    })

    test('quotes a model name a spreadsheet might read as a formula', async () => {
      const base = overview()

      backend(
        {
          [`GET ${OVERVIEW_PATH}`]: overview({
            current: {
              ...base.current,
              byModel: [
                { ...base.current.byModel[0], modelSlug: '=HYPERLINK("x")' }
              ]
            }
          })
        },
        'admin'
      )

      const { result } = await get(`/usage/${SLUG}/costs.csv`)

      expect(result).toContain('"\'=HYPERLINK(""x"")"')
    })

    test('only offers the link to an admin’s CSV on the Costs page, as a link, never as a form post', async () => {
      backend()

      const $ = load((await get(`/usage/${SLUG}/costs`)).result)

      expect($('[data-testid="costs-export"]').attr('href')).toBe(
        `/usage/${SLUG}/costs.csv`
      )
    })
  })

  describe('Carbon', () => {
    test('is not shown while carbon is off', async () => {
      backend()

      const response = await get(`/usage/${SLUG}/carbon`)

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(load(response.result)('h1').text()).toContain(
        'Carbon is not shown yet'
      )
    })

    test('shows the carbon, the electricity and the split by model once carbon is on', async () => {
      const base = overview()

      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          carbonBasis: { enabled: true },
          current: {
            ...base.current,
            totals: {
              ...base.current.totals,
              carbonKg: 11.7,
              electricityKwh: 58,
              carbonGramsPerMillionTokens: 27
            },
            forecast: { tokens: 1, cost: 1, carbonKg: 15.3 },
            byModel: base.current.byModel.map((model) => ({
              ...model,
              carbonKg: 5
            }))
          },
          months: base.months.map((month) => ({ ...month, carbonKg: 2 }))
        })
      })

      const $ = load((await get(`/usage/${SLUG}/carbon`)).result)

      expect($('h1').text().trim()).toBe('Carbon')
      expect(text($, '[data-testid="usage-cards"]')).toContain('11.7 kg')
      expect(text($, '[data-testid="usage-cards"]')).toContain('58 kWh')
      expect(text($, '[data-testid="usage-cards"]')).toContain('27 g')
      expect($('[data-testid="carbon-by-model"] tbody tr')).toHaveLength(2)
      expect($('.app-donut-pair svg')).toHaveLength(2)
      expect(text($, '[data-testid="carbon-method"]')).toContain('examples')
    })

    test('keeps the carbon table in a labelled keyboard-scrollable region', async () => {
      const base = overview()

      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          carbonBasis: { enabled: true },
          current: base.current
        })
      })

      const $ = load((await get(`/usage/${SLUG}/carbon`)).result)
      const region = $('[data-testid="carbon-by-model"]').closest(
        '.app-table-scroll'
      )

      expect(region.attr('role')).toBe('region')
      expect(region.attr('tabindex')).toBe('0')
      expect(region.attr('aria-label')).toBe('Carbon by model')
    })

    test('shows unavailable months separately from a zero estimate', async () => {
      const base = overview()

      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          carbonBasis: { enabled: true },
          months: base.months.map((month, index) =>
            index === 0
              ? { ...month, carbonKg: null }
              : index === 1
                ? { ...month, carbonKg: 0 }
                : month
          )
        })
      })

      const $ = load((await get(`/usage/${SLUG}/carbon`)).result)
      const monthlyCarbon = $('[data-testid="carbon-month-table"] tbody td')
        .map((_, cell) => $(cell).text().trim())
        .get()

      expect($('[data-testid="carbon-month-chart"] svg')).toHaveLength(0)
      expect(
        text($, '[data-testid="carbon-month-chart-unavailable"]')
      ).toContain('not available for one or more months')
      expect(monthlyCarbon.slice(0, 2)).toEqual(['Not available', '0.0 g'])
    })

    test('shows no share of carbon, and keeps the token shares, when a model has no factor', async () => {
      const base = overview()

      backend({
        [`GET ${OVERVIEW_PATH}`]: overview({
          carbonBasis: { enabled: true },
          current: {
            ...base.current,
            totals: { ...base.current.totals, carbonKg: null },
            byModel: base.current.byModel.map((model) => ({
              ...model,
              carbonKg: null
            }))
          }
        })
      })

      const $ = load((await get(`/usage/${SLUG}/carbon`)).result)

      expect($('.app-donut-pair svg')).toHaveLength(1)
      expect(text($, '[data-testid="carbon-donut-unavailable"]')).toContain(
        'Not available'
      )
      expect(text($, '[data-testid="carbon-by-model"] tbody tr')).toContain(
        '75%'
      )
      expect(text($, '[data-testid="carbon-by-model"] tbody tr')).toContain(
        'Not available'
      )
    })
  })

  describe('what the backend refuses or cannot do', () => {
    test('is the same 404 for a team that is not the persons as for one that does not exist', async () => {
      backend({
        [`GET ${OVERVIEW_PATH}`]: reply(404, { code: 'not-a-member' })
      })

      const response = await get(`/usage/${SLUG}`)

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(load(response.result)('h1').text()).toContain('Team not found')
    })

    test('says usage is not available yet when the team has no usage source', async () => {
      backend({
        [`GET ${OVERVIEW_PATH}`]: reply(404, { code: 'usage-not-available' })
      })

      const response = await get(`/usage/${SLUG}/costs`)

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(load(response.result)('h1').text()).toContain(
        'Usage is not available yet'
      )
    })

    test('says usage is not available just now when the backend fails, with a way to try again', async () => {
      backend({
        [`GET ${OVERVIEW_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const response = await get(`/usage/${SLUG}`)
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect($('h1').text()).toContain('not available just now')
      expect($('a.govuk-button').attr('href')).toBe(`/usage/${SLUG}`)
    })

    test('needs a signed-in person', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/usage/${SLUG}`
      })

      expect(response.statusCode).toBe(statusCodes.found)
    })
  })
})

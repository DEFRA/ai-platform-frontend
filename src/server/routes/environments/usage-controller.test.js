import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import { INFRADEV_URL, TEAM_PATH } from '#/test-helpers/environments-helpers.js'
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

const USAGE_URL = `${INFRADEV_URL}/usage`
const USAGE_PATH = `${TEAM_PATH}/environments/infradev/usage`

function usage(overrides = {}) {
  return {
    teamId: 'team-1',
    environment: 'infradev',
    source: 'log-analytics',
    period: { from: '2026-10-28', to: '2026-11-27', days: 30 },
    costBasis: { estimate: true, currency: 'USD', priceVersion: 'v1' },
    totals: {
      requests: 1234,
      promptTokens: 2000000,
      completionTokens: 300000,
      totalTokens: 2300000,
      estimatedCost: 8.5
    },
    byDay: [
      {
        day: '2026-11-25',
        requests: 4,
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120
      },
      {
        day: '2026-11-26',
        requests: 10,
        promptTokens: 400,
        completionTokens: 80,
        totalTokens: 480
      }
    ],
    byModel: [
      {
        modelSlug: 'gpt-4o',
        requests: 14,
        promptTokens: 500,
        completionTokens: 100,
        totalTokens: 600,
        estimatedCost: 8.5
      }
    ],
    unpricedModels: [],
    ...overrides
  }
}

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('#usageController', () => {
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
    fetchMock.resetMocks()
    cookies = await signInViaOidc(server, fetchMock)
  })

  function backend(routes = {}, role = 'user') {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${USAGE_PATH}?days=30`]: usage(),
      ...routes
    })
  }

  function get(url = USAGE_URL) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
    })
  }

  test('shows a member the totals, each model and each day', async () => {
    backend()

    const response = await get()
    const $ = load(response.result)

    expect(response.statusCode).toBe(statusCodes.ok)
    expect($('h1').text().trim()).toBe('Usage in Infradev')
    expect(text($, '[data-testid="usage-period"]')).toBe(
      '28 October 2026 to 26 November 2026.'
    )
    expect(text($, '[data-testid="usage-totals"]')).toContain('1,234')
    expect(text($, '[data-testid="usage-totals"]')).toContain('2,300,000')
    expect(text($, '[data-testid="usage-totals"]')).toContain('US$8.50')
    expect(text($, '[data-testid="usage-by-model"]')).toContain('gpt-4o')
    expect($('[data-testid="usage-by-day"] tbody tr')).toHaveLength(2)
  })

  test('always says the cost is an estimate', async () => {
    backend()

    const $ = load((await get()).result)

    expect(text($, '[data-testid="usage-cost-notice"]')).toContain(
      'is an estimate'
    )
  })

  test('says so when the figures are examples, and not otherwise', async () => {
    backend({ [`GET ${USAGE_PATH}?days=30`]: usage({ source: 'mock' }) })

    expect(
      load((await get()).result)('[data-testid="usage-mock-notice"]')
    ).toHaveLength(1)

    backend()

    expect(
      load((await get()).result)('[data-testid="usage-mock-notice"]')
    ).toHaveLength(0)
  })

  test('says "Not available" for a cost with no price, never 0, and names the model', async () => {
    backend({
      [`GET ${USAGE_PATH}?days=30`]: usage({
        totals: { ...usage().totals, estimatedCost: null },
        byModel: [{ ...usage().byModel[0], estimatedCost: null }],
        unpricedModels: ['gpt-4o']
      })
    })

    const $ = load((await get()).result)

    expect(text($, '[data-testid="usage-totals"]')).toContain('Not available')
    expect(text($, '[data-testid="usage-unpriced"]')).toContain('gpt-4o')
  })

  test('says there were no requests, and shows no tables, for a quiet team', async () => {
    backend({
      [`GET ${USAGE_PATH}?days=30`]: usage({
        totals: {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0
        },
        byModel: [],
        byDay: []
      })
    })

    const $ = load((await get()).result)

    expect(text($, '[data-testid="usage-empty"]')).toContain('no requests')
    expect($('[data-testid="usage-by-model"]')).toHaveLength(0)
  })

  test.each([
    ['?days=7', 7],
    ['?days=90', 90]
  ])('asks the backend for the period in %s', async (query, days) => {
    backend({ [`GET ${USAGE_PATH}?days=${days}`]: usage() })

    await get(`${USAGE_URL}${query}`)

    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request.url ?? request).endsWith(`usage?days=${days}`)
      )
    ).toBe(true)
  })

  test('asks for 30 days when the address asks for anything else', async () => {
    backend()

    const response = await get(`${USAGE_URL}?days=999%3B%20drop`)

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(
      fetchMock.mock.calls.every(
        ([request]) => !String(request.url ?? request).includes('drop')
      )
    ).toBe(true)
  })

  test('links the other periods and marks the one shown', async () => {
    backend()

    const $ = load((await get()).result)

    expect($('[data-testid="usage-periods"] a')).toHaveLength(2)
    expect(
      $('[data-testid="usage-periods"] [aria-current="page"]').text()
    ).toBe('Last 30 days')
  })

  test('gives a table beside every bar, and hides the bar from a screen reader', async () => {
    backend()

    const $ = load((await get()).result)

    expect($('[data-testid="usage-by-day"] meter').attr('aria-hidden')).toBe(
      'true'
    )
    expect($('[data-testid="usage-by-day"] td').first().text().trim()).toBe('4')
  })

  test('is the same 404 for a team that is not the persons as for one that does not exist', async () => {
    backend({
      [`GET ${TEAM_PATH}`]: reply(404, { code: 'not-a-member' }),
      [`GET ${USAGE_PATH}?days=30`]: reply(404, { code: 'not-a-member' })
    })

    const response = await get()

    expect(response.statusCode).toBe(statusCodes.notFound)
    expect(load(response.result)('h1').text()).toContain('Team not found')
  })

  test('says usage is not available for an environment with no source', async () => {
    backend({
      [`GET ${USAGE_PATH}?days=30`]: reply(404, { code: 'usage-not-available' })
    })

    const response = await get()

    expect(response.statusCode).toBe(statusCodes.notFound)
    expect(load(response.result)('h1').text()).toContain(
      'Usage is not available in Infradev yet'
    )
  })

  test('says the environment is not found when the backend does not offer it', async () => {
    backend({
      [`GET ${USAGE_PATH}?days=30`]: reply(404, {
        code: 'environment-not-available'
      })
    })

    const response = await get()

    expect(response.statusCode).toBe(statusCodes.notFound)
    expect(load(response.result)('h1').text()).toContain(
      'Environment not found'
    )
  })

  test('says usage is not available just now when the backend fails, with a way to try again', async () => {
    backend({
      [`GET ${USAGE_PATH}?days=30`]: reply(502, {
        code: 'upstream-unavailable'
      })
    })

    const response = await get()
    const $ = load(response.result)

    expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
    expect($('h1').text()).toContain('not available just now')
    expect($('a.govuk-button').attr('href')).toBe(`${USAGE_URL}?days=30`)
  })

  test('is not found for an environment this instance does not know', async () => {
    backend()

    const response = await get('/environments/flood-risk-mapping/nowhere/usage')

    expect(response.statusCode).toBe(statusCodes.notFound)
  })

  test('needs a signed-in person', async () => {
    const response = await server.inject({ method: 'GET', url: USAGE_URL })

    expect(response.statusCode).toBe(statusCodes.found)
  })
})

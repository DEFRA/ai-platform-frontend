import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  mergeCookies,
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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const sampleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai'
}

const sampleCredential = {
  _id: 'cred-1',
  modelSlug: 'gpt-4o',
  status: 'active',
  keyHint: 'ab12',
  expiresAt: '2026-09-23T00:00:00.000Z',
  renewalCount: 0,
  renewalsRemaining: 3
}

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
}

describe('#manageController', () => {
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

  test('GET /manage redirects to /sign-in when signed out', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/manage'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/sign-in?returnTo=%2Fmanage')
  })

  describe('GET /manage (Your access)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    const HOUR_MS = 60 * 60 * 1000
    const NOW = new Date('2026-10-22T12:00:00.000Z')

    // Only Date is frozen, so the sign-in and request timers stay real and
    // the day counts cannot change under the test (even near midnight).
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function inDays(days) {
      return new Date(NOW.getTime() + days * DAY_MS).toISOString()
    }

    function longDate(iso) {
      return formatDate(iso)
    }

    function ownKey(overrides = {}) {
      return {
        ...sampleCredential,
        tier: 'research',
        expiresAt: inDays(5),
        ...overrides
      }
    }

    async function getManage(items, models = [sampleModel]) {
      const cookies = await signIn(server)

      fetchMock.resetMocks()
      fetchMock.mockResponseOnce(JSON.stringify({ items }))
      fetchMock.mockResponseOnce(JSON.stringify({ items: models }))

      const response = await server.inject({
        method: 'GET',
        url: '/manage',
        headers: { cookie: cookieHeader(cookies) }
      })

      return { ...response, $: load(response.result) }
    }

    test('redirects to /sign-in when signed out', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/manage'
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/sign-in?returnTo=%2Fmanage')
    })

    test('has the heading and lead, with the days and renewals the platform allows', async () => {
      const { $, statusCode } = await getManage([ownKey()])

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text().trim()).toBe('Your access')
      expect($('[data-testid="access-lead"]').text().trim()).toBe(
        'Keys for trying models on your own. A key works for 7 days, and you can renew it up to 3 times.'
      )
    })

    test('for a person with only their own key: the model, the date and days left, and View, Renew and Revoke, with no tag', async () => {
      const expiresAt = inDays(5)
      const { $ } = await getManage([ownKey({ expiresAt })])
      const rows = $('[data-testid="keys-table-row"]')

      expect($('th[scope="col"]').first().text()).toBe('Model')
      expect($('th[scope="col"]').eq(1).text()).toBe('Expires')
      expect(rows).toHaveLength(1)
      expect(rows.find('td').eq(0).text().trim()).toBe('GPT-4o')
      expect(rows.find('td').eq(1).text().trim()).toBe(
        `${longDate(expiresAt)}, in 5 days`
      )
      expect(rows.find('[data-testid="key-renewed-hint"]')).toHaveLength(0)
      expect(rows.find('.govuk-tag')).toHaveLength(0)
      expect(
        rows.find('[data-testid="credential-action-view"]').attr('href')
      ).toBe('/manage/credentials/cred-1')
      expect(rows.find('[data-testid="credential-action-renew"]')).toHaveLength(
        1
      )
      expect(
        rows.find('[data-testid="credential-action-revoke"]')
      ).toHaveLength(1)
    })

    test('says "in 1 day" and "today" at the end of the key’s life', async () => {
      const { $ } = await getManage([
        ownKey({ _id: 'cred-1', expiresAt: inDays(1) }),
        ownKey({
          _id: 'cred-2',
          expiresAt: new Date(NOW.getTime() + HOUR_MS).toISOString()
        })
      ])
      const cells = $('[data-testid="keys-table-row"]').find('td:nth-child(2)')

      expect(cells.eq(0).text()).toContain(', in 1 day')
      expect(cells.eq(0).text()).not.toContain('days')
      expect(cells.eq(1).text()).toContain(', today')
    })

    test('hints "Renewed once" and "Renewed {n} times" when a key has been renewed', async () => {
      const { $ } = await getManage([
        ownKey({ _id: 'cred-1', renewalCount: 1, renewalsRemaining: 2 }),
        ownKey({ _id: 'cred-2', renewalCount: 2, renewalsRemaining: 1 })
      ])
      const hints = $('[data-testid="key-renewed-hint"]')

      expect(hints.eq(0).text()).toBe('Renewed once')
      expect(hints.eq(1).text()).toBe('Renewed 2 times')
    })

    test('an expired key says when it expired, and can still be renewed while renewals remain', async () => {
      const expiresAt = inDays(-2)
      const { $ } = await getManage([
        ownKey({
          status: 'expired',
          expiresAt,
          renewalCount: 1,
          renewalsRemaining: 2
        })
      ])
      const row = $('[data-testid="keys-table-row"]')

      expect(row.find('td').eq(1).text()).toContain(
        `Expired on ${longDate(expiresAt)}`
      )
      expect(row.find('td').eq(1).text()).not.toContain(' in ')
      expect(row.find('[data-testid="key-renewed-hint"]').text()).toBe(
        'Renewed once'
      )
      expect(row.find('[data-testid="credential-action-renew"]')).toHaveLength(
        1
      )
      expect(row.find('[data-testid="key-get-new"]')).toHaveLength(0)
      expect(row.find('.govuk-tag')).toHaveLength(0)
    })

    test('an expired key renewed as often as allowed says so, and offers "Get a new key" instead of any other action', async () => {
      const { $ } = await getManage([
        ownKey({
          status: 'expired',
          expiresAt: inDays(-1),
          renewalCount: 3,
          renewalsRemaining: 0
        })
      ])
      const row = $('[data-testid="keys-table-row"]')

      expect(row.find('[data-testid="key-renewed-hint"]').text()).toBe(
        'Renewed 3 times, so it cannot be renewed again'
      )
      expect(row.find('[data-testid="key-get-new"]').attr('href')).toBe(
        '/connect/shared/start?modelSlug=gpt-4o'
      )
      expect(row.find('[data-testid="credential-actions"]')).toHaveLength(0)
    })

    test('an active key with no renewals left shows no Renew, and no “cannot be renewed again” hint', async () => {
      const { $ } = await getManage([
        ownKey({ renewalCount: 3, renewalsRemaining: 0 })
      ])
      const row = $('[data-testid="keys-table-row"]')

      expect(row.find('[data-testid="credential-action-renew"]')).toHaveLength(
        0
      )
      expect(row.find('[data-testid="credential-action-revoke"]')).toHaveLength(
        1
      )
      expect(row.find('[data-testid="key-renewed-hint"]').text()).toBe(
        'Renewed 3 times'
      )
    })

    test('links to try another model on their own, and to Teams in an inset', async () => {
      const { $ } = await getManage([ownKey()])

      expect($('[data-testid="access-try-another"]').attr('href')).toBe(
        '/connect/shared/start'
      )
      expect($('[data-testid="access-try-another"]').text()).toBe(
        'Try another model on your own'
      )
      expect($('[data-testid="access-teams-inset"]').text()).toContain(
        'Your teams’ models and client secrets are on each team’s page.'
      )
      expect($('[data-testid="access-go-to-teams"]').attr('href')).toBe(
        '/teams'
      )
      expect($('[data-testid="access-go-to-teams"]').text()).toBe('Go to Teams')
    })

    test('shows no key yet, still with both links, when there is nothing to list', async () => {
      const { $, statusCode } = await getManage([])

      expect(statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="keys-empty"]').text()).toBe(
        'You do not have a key yet.'
      )
      expect($('[data-testid="keys-table"]')).toHaveLength(0)
      expect($('[data-testid="access-try-another"]')).toHaveLength(1)
      expect($('[data-testid="access-go-to-teams"]')).toHaveLength(1)
    })

    test('hides failed, pending and revoked keys, which were never or are no longer usable', async () => {
      const { $ } = await getManage([
        ownKey({ _id: 'cred-failed-1', status: 'failed' }),
        ownKey({ _id: 'cred-failed-2', status: 'failed' }),
        ownKey({ _id: 'cred-pending', status: 'pending' }),
        ownKey({ _id: 'cred-revoked', status: 'revoked' })
      ])

      expect($('[data-testid="keys-table-row"]')).toHaveLength(0)
      expect($('[data-testid="keys-empty"]')).toHaveLength(1)
    })

    test.each([
      ['a team member', 'member'],
      ['a team admin', 'admin']
    ])(
      'for %s, shows only their own key: no team row, no team model, no client secret, and no team lookup',
      async (_who, role) => {
        const { $, result } = await getManage([
          ownKey(),
          {
            ...sampleCredential,
            _id: `cred-team-${role}`,
            teamId: 'team-1',
            tier: 'team',
            credentialType: 'oauth',
            allowedDeployments: ['gpt-4o'],
            expiresAt: null
          }
        ])

        expect($('[data-testid="keys-table-row"]')).toHaveLength(1)
        expect(result).not.toContain(`cred-team-${role}`)
        expect(result).not.toContain('/rotate')
        expect(result).not.toContain('Your models')
        expect(result).not.toContain('Your teams</h2>')
        expect(result).not.toContain('Flood Risk Team')
        expect(result).not.toContain('Manage in')
        expect(result).not.toContain('http-equiv="refresh"')
        expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
          expect.stringContaining('/v1/credentials'),
          expect.stringContaining('/v1/models')
        ])
      }
    )

    test('says there is no key when the only credential is a team client secret', async () => {
      const { $ } = await getManage([
        {
          ...sampleCredential,
          teamId: 'team-3',
          tier: 'team',
          allowedDeployments: ['gpt-4o']
        }
      ])

      expect($('[data-testid="keys-empty"]')).toHaveLength(1)
      expect($('[data-testid="keys-table-row"]')).toHaveLength(0)
    })

    test('keeps a research key personal even when its stamped teamId no longer matches any current team', async () => {
      const { $ } = await getManage([
        ownKey({ _id: 'cred-stale-team', teamId: 'team-old' })
      ])

      expect($('[data-testid="keys-table-row"]')).toHaveLength(1)
      expect($('[data-testid="keys-empty"]')).toHaveLength(0)
    })

    test('shows no date for a key without an expiry, rather than failing', async () => {
      const { $, statusCode } = await getManage([ownKey({ expiresAt: null })])

      expect(statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="keys-table-row"] td').eq(1).text().trim()).toBe(
        ''
      )
    })

    test('falls back to the model slug when the catalogue does not list the model', async () => {
      const { $ } = await getManage([ownKey()], [])

      expect($('[data-testid="keys-table-row"] td').first().text().trim()).toBe(
        'gpt-4o'
      )
    })
  })

  test('POST /manage/credentials/{id}/renew shows a success banner', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleCredential, renewalCount: 1 })
    )

    const postRenew = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/renew',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postRenew.statusCode).toBe(303)
    expect(postRenew.headers.location).toBe('/manage')

    const redirectCookies = mergeCookies(cookies, postRenew)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(expect.stringContaining('Credential renewed'))
  })

  test('POST /manage/credentials/{id}/renew shows an error banner once the cap is reached', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Renewal cap reached for this credential',
        code: 'renewal-cap-reached'
      }),
      { status: 403 }
    )

    const postRenew = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/renew',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postRenew.statusCode).toBe(303)

    const redirectCookies = mergeCookies(cookies, postRenew)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('Renewal cap reached for this credential')
    )
  })

  test('GET /manage/credentials/{id}/revoke shows the confirm page', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
  })

  test('POST /manage/credentials/{id}/revoke with "no" takes no action', async () => {
    const cookies = await signIn(server)
    fetchMock.mockClear()

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, confirmRevoke: 'no' }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/manage')
    expect(fetchMock.mock.calls).toHaveLength(0)
  })

  test('POST /manage/credentials/{id}/revoke with "yes" revokes and shows a banner', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(null, { status: 204 })

    const postRevoke = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, confirmRevoke: 'yes' }
    })

    expect(postRevoke.statusCode).toBe(303)

    const redirectCookies = mergeCookies(cookies, postRevoke)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(expect.stringContaining('Credential revoked'))
  })

  test('POST /manage/credentials/{id}/revoke rejects an unselected radio', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('GET /manage/credentials/{id}/revoke redirects to /manage for an unknown id', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 404,
        error: 'Not Found',
        message: 'Not Found'
      }),
      { status: 404 }
    )

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/unknown-id/revoke',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/manage')
  })

  test('GET /manage/credentials/{id} shows the persistent detail page', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
    expect(result).toEqual(expect.stringContaining('ab12'))
    expect(result).toEqual(expect.stringContaining('Renew'))
    expect(result).toEqual(expect.stringContaining('Revoke this credential'))
  })

  test.each([
    [
      'infradev',
      'Development',
      'https://apim-aip-infradev.azure-api.net/research/'
    ],
    ['sandbox', 'Sandbox', 'https://deploytestdefra.azure-api.net/research/'],
    [null, 'Sandbox', 'https://deploytestdefra.azure-api.net/research/']
  ])(
    'GET /manage/credentials/{id} for a research key issued in %s says so and shows that gateway',
    async (environment, expectedName, expectedHost) => {
      const cookies = await signIn(server)

      fetchMock.mockResponseOnce(
        JSON.stringify({ ...sampleCredential, environment })
      )
      fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

      const { result } = await server.inject({
        method: 'GET',
        url: '/manage/credentials/cred-1',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(result).toMatch(
        new RegExp(`Environment\\s*</dt>\\s*<dd[^>]*>\\s*${expectedName}`)
      )
      expect(result).toEqual(expect.stringContaining(expectedHost))
    }
  )

  test('GET /manage/credentials/{id} shows a red tag for a revoked credential', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleCredential, status: 'revoked' })
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(expect.stringContaining('govuk-tag--red'))
  })

  test('GET /manage/credentials/{id} shows a not found page for an unknown id', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 404,
        error: 'Not Found',
        message: 'Not Found'
      }),
      { status: 404 }
    )

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/unknown-id',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Credential not found'))
  })

  test('GET /manage/credentials/{id} shows a "View full key" link for an active research credential', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('/manage/credentials/cred-1/view')
    )
    expect(result).toContain('View full key')
    expect(result).toMatch(
      /Access\s*<\/dt>\s*<dd[^>]*>\s*On your own \(free trial\)/
    )
    expect(result).not.toContain('Research (free trial)')
    expect(result).not.toContain('View full client secret')
  })

  test('GET /manage/credentials/{id}/view shows the reason form', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/view',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('Why do you need to see this?')
    )
    expect(result).toContain('View the full key for GPT-4o')
    expect(result).not.toContain('client secret')
  })

  test('POST /manage/credentials/{id}/view without a reason re-renders with an error', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/view',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, reason: '' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('POST /manage/credentials/{id}/view with a reason reveals the secret once', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify({ secret: 'full_mock_secret' }))

    const postReveal = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/view',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, reason: 'Debugging a failed call' }
    })

    expect(postReveal.statusCode).toBe(303)
    expect(postReveal.headers.location).toBe(
      '/manage/credentials/cred-1/revealed'
    )

    const redirectCookies = mergeCookies(cookies, postReveal)
    const getRevealed = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/revealed',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(getRevealed.statusCode).toBe(statusCodes.ok)
    expect(getRevealed.headers['cache-control']).toEqual(
      expect.stringContaining('no-store')
    )
    expect(getRevealed.result).toEqual(
      expect.stringContaining('full_mock_secret')
    )
    expect(getRevealed.result).toContain('Copy key')
    expect(getRevealed.result).not.toContain('client secret')

    const cookiesAfterRevealed = mergeCookies(redirectCookies, getRevealed)
    const getRevealedAgain = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/revealed',
      headers: { cookie: cookieHeader(cookiesAfterRevealed) }
    })

    expect(getRevealedAgain.statusCode).toBe(303)
    expect(getRevealedAgain.headers.location).toBe('/manage')
  })

  test('POST /manage/credentials/{id}/view shows a banner when the credential has been revoked', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleCredential, status: 'revoked' })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        code: 'credential-revoked',
        message: 'Credential has been revoked'
      }),
      { status: 409 }
    )

    const postReveal = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/view',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, reason: 'Debugging a failed call' }
    })

    expect(postReveal.statusCode).toBe(303)
    expect(postReveal.headers.location).toBe('/manage')

    const redirectCookies = mergeCookies(cookies, postReveal)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const getManage = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(getManage.result).toEqual(
      expect.stringContaining('This credential has been revoked.')
    )
  })

  describe('a team client secret is managed on the team’s page, not here', () => {
    const teamCredential = {
      ...sampleCredential,
      _id: 'cred-team',
      tier: 'team',
      teamId: 'team-1',
      allowedDeployments: ['gpt-4o']
    }

    function calledWithMethod(method) {
      return fetchMock.mock.calls.some(([, init]) => init?.method === method)
    }

    test('GET /manage/credentials/{id} is not found', async () => {
      const cookies = await signIn(server)

      fetchMock.mockResponseOnce(JSON.stringify(teamCredential))

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/manage/credentials/cred-team',
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Credential not found')
    })

    test.each(['revoke', 'view'])(
      'GET /manage/credentials/{id}/%s goes back to the access page',
      async (step) => {
        const cookies = await signIn(server)

        fetchMock.mockResponseOnce(JSON.stringify(teamCredential))

        const { statusCode, headers } = await server.inject({
          method: 'GET',
          url: `/manage/credentials/cred-team/${step}`,
          headers: { cookie: cookieHeader(cookies) }
        })

        expect(statusCode).toBe(303)
        expect(headers.location).toBe('/manage')
      }
    )

    test('POST /manage/credentials/{id}/revoke does not revoke it', async () => {
      const cookies = await signIn(server)

      fetchMock.mockClear()
      fetchMock.mockResponseOnce(JSON.stringify(teamCredential))

      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url: '/manage/credentials/cred-team/revoke',
        headers: { cookie: cookieHeader(cookies) },
        payload: { crumb: cookies.crumb, confirmRevoke: 'yes' }
      })

      expect(statusCode).toBe(303)
      expect(headers.location).toBe('/manage')
      expect(calledWithMethod('DELETE')).toBe(false)
    })

    test('POST /manage/credentials/{id}/view does not reveal it', async () => {
      const cookies = await signIn(server)

      fetchMock.mockClear()
      fetchMock.mockResponseOnce(JSON.stringify(teamCredential))

      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url: '/manage/credentials/cred-team/view',
        headers: { cookie: cookieHeader(cookies) },
        payload: { crumb: cookies.crumb, reason: 'Debugging a failed call' }
      })

      expect(statusCode).toBe(303)
      expect(headers.location).toBe('/manage')
      expect(calledWithMethod('POST')).toBe(false)
    })

    test.each(['rotate', 'rotated'])(
      'GET /manage/credentials/{id}/%s is no longer a page',
      async (step) => {
        const cookies = await signIn(server)

        const { statusCode } = await server.inject({
          method: 'GET',
          url: `/manage/credentials/cred-team/${step}`,
          headers: { cookie: cookieHeader(cookies) }
        })

        expect(statusCode).toBe(statusCodes.notFound)
      }
    )
  })
})

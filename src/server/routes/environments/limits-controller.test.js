import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  INFRADEV_URL,
  TEAM_PATH,
  detail,
  openOperation,
  operationsAnswer
} from '#/test-helpers/environments-helpers.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
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

const LIMITS_URL = `${INFRADEV_URL}/limits`
const CHECK_URL = `${LIMITS_URL}/check`
const LIMITS_PATH = `${TEAM_PATH}/environments/infradev/limits`
const NOT_MEMBER = reply(404, { code: 'not-a-member', message: 'Not found' })
const BOUNDS = {
  tokensPerMinute: { min: 1, max: 5000 },
  requestsPerMinute: { min: 1, max: 300 }
}

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('#limitsController', () => {
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

  function backend({ role = 'admin', ...routes } = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${TEAM_PATH}/environments/infradev`]: detail(),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      'GET /v1/models': { items: [sampleModel] },
      'GET /v1/credentials': { items: [] },
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

  function post(url, payload = {}, jar = cookies) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(jar) },
      payload: { crumb: jar.crumb, ...payload }
    })
  }

  // The questions answered, ready for the check page.
  async function answered(payload = {}) {
    backend()

    const response = await post(LIMITS_URL, {
      tokensPerMinute: '2000',
      requestsPerMinute: '120',
      ...payload
    })

    return mergeCookies(cookies, response)
  }

  // The limits changes asked for (the sign-in's own PUT is not one).
  function putCalls() {
    return fetchMock.mock.calls.filter(
      ([url, init]) => init?.method === 'PUT' && url.includes('/limits')
    )
  }

  describe('the question page', () => {
    test('asks for tokens and requests a minute, with the bounds in the hints and the current limits filled in', async () => {
      backend()

      const { statusCode, result } = await get(LIMITS_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(text($, '[data-testid="app-heading-caption"]')).toBe(
        'Flood Risk Team'
      )
      expect(text($, 'h1')).toBe('Change the limits in Infradev')
      expect($('title').text()).toContain('Change the limits in Infradev')
      expect($('label[for="tokensPerMinute"]').text().trim()).toBe(
        'Tokens a minute'
      )
      expect($('label[for="requestsPerMinute"]').text().trim()).toBe(
        'Requests a minute'
      )
      expect(text($, '#tokensPerMinute-hint')).toBe(
        'Between 1 and 5,000. Your team has 1,000 now.'
      )
      expect(text($, '#requestsPerMinute-hint')).toBe(
        'Between 1 and 300. Your team has 60 now.'
      )
      expect($('#tokensPerMinute').attr('value')).toBe('1000')
      expect($('#requestsPerMinute').attr('value')).toBe('60')
      expect($('#tokensPerMinute').attr('inputmode')).toBe('numeric')
      expect($('a.govuk-back-link').attr('href')).toBe(INFRADEV_URL)
      expect($('main form input[name="crumb"]')).toHaveLength(1)
    })

    test('shows what a change in progress will set, rather than what the file holds', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          pendingLimits: { tokensPerMinute: 3000, requestsPerMinute: 150 }
        })
      })

      const $ = load((await get(LIMITS_URL)).result)

      expect($('#tokensPerMinute').attr('value')).toBe('3000')
      expect(text($, '#tokensPerMinute-hint')).toContain(
        'Your team is changing to 3,000.'
      )
    })

    test('keeps what was typed when asked again from the check page', async () => {
      const jar = await answered({ tokensPerMinute: '2500' })

      backend()
      const $ = load((await get(LIMITS_URL, jar)).result)

      expect($('#tokensPerMinute').attr('value')).toBe('2500')
    })

    test('is 403 for a member, who is offered no change, and asks the backend for nothing more', async () => {
      backend({ role: 'user' })

      const { statusCode, result } = await get(LIMITS_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(text($, 'h1')).toBe('You cannot change the limits')
      expect(text($, 'main')).toContain(
        'Only a team admin can change the limits in Infradev.'
      )
      expect($('main form')).toHaveLength(0)
      expect(
        $('a[href="/environments/flood-risk-team/infradev"]')
      ).not.toHaveLength(0)
    })

    test('is 404 for a person who is not a member, with nothing about the team', async () => {
      backend({ [`GET ${TEAM_PATH}/environments/infradev`]: NOT_MEMBER })

      const { statusCode, result } = await get(LIMITS_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(text(load(result), 'main')).not.toContain('Flood Risk Team')
    })

    test.each(['qa', 'nowhere'])(
      'is 404 for %s, which is not an available environment',
      async (code) => {
        backend()

        const { statusCode } = await get(
          `/environments/${sampleTeam.slug}/${code}/limits`
        )

        expect(statusCode).toBe(statusCodes.notFound)
      }
    )

    test('says the environment is not set up when there is nothing to change the limits of', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          setUp: false,
          limits: null,
          limitBounds: null,
          models: []
        })
      })

      const { statusCode, result } = await get(LIMITS_URL)

      expect(statusCode).toBe(statusCodes.conflict)
      expect(text(load(result), 'main')).toContain(
        'Infradev is not set up yet, so it has no limits to change.'
      )
    })

    test('says it could not read the environment when the backend is unavailable', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { statusCode, result } = await get(LIMITS_URL)

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(load(result), 'main')).toContain('We could not read')
    })

    test('redirects to sign in when signed out', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: LIMITS_URL
      })

      expect(statusCode).toBe(statusCodes.found)
    })
  })

  describe('answering', () => {
    test('goes to the check page with valid answers, sending nothing to the backend yet', async () => {
      backend()

      const response = await post(LIMITS_URL, {
        tokensPerMinute: '2000',
        requestsPerMinute: '120'
      })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(CHECK_URL)
      expect(putCalls()).toHaveLength(0)
    })

    test.each([
      ['2,000', '120'],
      [' 2000 ', ' 120 '],
      ['5000', '300'],
      ['1', '1']
    ])(
      'accepts %j and %j, with commas or spaces, and the bounds themselves',
      async (tokensPerMinute, requestsPerMinute) => {
        backend()

        const response = await post(LIMITS_URL, {
          tokensPerMinute,
          requestsPerMinute
        })

        expect(response.statusCode).toBe(statusCodes.seeOther)
      }
    )

    test('asks for both, with an error summary and a message by each field, keeping what was typed', async () => {
      backend()

      const { statusCode, result } = await post(LIMITS_URL, {
        tokensPerMinute: '',
        requestsPerMinute: '   '
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('title').text()).toContain(
        'Error: Change the limits in Infradev'
      )
      expect(text($, '.govuk-error-summary')).toContain('There is a problem')
      expect(
        $('.govuk-error-summary__list a')
          .map((_, link) => [[$(link).text().trim(), $(link).attr('href')]])
          .get()
      ).toEqual([
        ['Enter the tokens a minute', '#tokensPerMinute'],
        ['Enter the requests a minute', '#requestsPerMinute']
      ])
      expect(text($, '#tokensPerMinute-error')).toContain(
        'Enter the tokens a minute'
      )
      expect($('#tokensPerMinute').hasClass('govuk-input--error')).toBe(true)
    })

    test.each([
      ['12.5', 'must be a whole number'],
      ['abc', 'must be a whole number'],
      ['-5', 'must be a whole number'],
      ['1e3', 'must be a whole number']
    ])('refuses %j: tokens a minute %s', async (value, message) => {
      backend()

      const { statusCode, result } = await post(LIMITS_URL, {
        tokensPerMinute: value,
        requestsPerMinute: '60'
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(text(load(result), '#tokensPerMinute-error')).toContain(message)
      expect(load(result)('#tokensPerMinute').attr('value')).toBe(value)
      expect(load(result)('#requestsPerMinute').attr('value')).toBe('60')
    })

    test.each([
      ['0', 'Tokens a minute must be between 1 and 5,000', 'tokensPerMinute'],
      ['5001', 'Tokens a minute must be between 1 and 5,000', 'tokensPerMinute']
    ])(
      'states the bounds and queues nothing for %j',
      async (value, message, field) => {
        backend()

        const { statusCode, result } = await post(LIMITS_URL, {
          tokensPerMinute: value,
          requestsPerMinute: '60'
        })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect(text($, `#${field}-error`)).toContain(message)
        expect(text($, '.govuk-error-summary')).toContain(message)
        expect(putCalls()).toHaveLength(0)
      }
    )

    test('states the bounds for requests a minute too', async () => {
      backend()

      const { result } = await post(LIMITS_URL, {
        tokensPerMinute: '1000',
        requestsPerMinute: '301'
      })

      expect(text(load(result), '#requestsPerMinute-error')).toContain(
        'Requests a minute must be between 1 and 300'
      )
    })

    test('is 403 for a member who posts anyway, and keeps nothing', async () => {
      backend({ role: 'user' })

      const response = await post(LIMITS_URL, {
        tokensPerMinute: '2000',
        requestsPerMinute: '120'
      })

      expect(response.statusCode).toBe(statusCodes.forbidden)

      backend({ role: 'user' })
      const check = await get(CHECK_URL, mergeCookies(cookies, response))

      expect(check.statusCode).toBe(statusCodes.forbidden)
    })

    test('has no CSRF bypass: a post without the token is refused', async () => {
      backend()

      const response = await server.inject({
        method: 'POST',
        url: LIMITS_URL,
        headers: { cookie: cookieHeader(cookies) },
        payload: { tokensPerMinute: '2000', requestsPerMinute: '120' }
      })

      expect(response.statusCode).toBe(statusCodes.forbidden)
    })
  })

  describe('the check page', () => {
    test('shows the new limits and the environment, each answer with a Change link, and a button to confirm', async () => {
      const jar = await answered()

      backend()
      const { statusCode, result } = await get(CHECK_URL, jar)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(text($, 'h1')).toBe('Check your answers')
      expect(text($, '[data-testid="app-heading-caption"]')).toBe(
        'Flood Risk Team'
      )
      expect(
        $('.govuk-summary-list__row')
          .map((_, row) => [
            [
              $(row).find('dt').text().trim(),
              $(row).find('dd').first().text().trim()
            ]
          ])
          .get()
      ).toEqual([
        ['Environment', 'Infradev'],
        ['Tokens a minute', '2,000'],
        ['Requests a minute', '120']
      ])
      expect(
        $('.govuk-summary-list__actions a')
          .map((_, link) => $(link).attr('href'))
          .get()
      ).toEqual([LIMITS_URL, LIMITS_URL])
      expect($('button').text()).toContain('Change limits')
      expect($('a.govuk-back-link').attr('href')).toBe(LIMITS_URL)
    })

    test('goes back to the question when there is nothing to check', async () => {
      backend()

      const response = await get(CHECK_URL)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(LIMITS_URL)
    })

    test('does not offer another environment’s or another team’s answers', async () => {
      const jar = await answered()

      config.set('teamEnvironments', ['infradev', 'qa'])
      backend({
        [`GET ${TEAM_PATH}/environments/qa`]: detail({ environment: 'qa' })
      })
      const response = await get(
        `${INFRADEV_URL.replace('infradev', 'qa')}/limits/check`,
        jar
      )

      config.set('teamEnvironments', configured)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(
        `${INFRADEV_URL.replace('infradev', 'qa')}/limits`
      )
    })
  })

  describe('confirming', () => {
    test('asks the backend for one change with an Idempotency-Key, then shows on the environment page that the limits are changing', async () => {
      const jar = await answered()
      let key
      let body

      backend({
        [`PUT ${LIMITS_PATH}`]: async (request) => {
          key = request.headers.get('idempotency-key')
          body = await request.json()

          return reply(202, {
            operation: openOperation({
              id: 'op-limits-1',
              kind: 'limits',
              changes: [{ kind: 'limits', change: 'set', limits: body }]
            })
          })
        }
      })

      const confirmed = await post(CHECK_URL, {}, jar)

      expect(confirmed.statusCode).toBe(statusCodes.seeOther)
      expect(confirmed.headers.location).toBe(INFRADEV_URL)
      expect(body).toEqual({ tokensPerMinute: 2000, requestsPerMinute: 120 })
      expect(key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
      expect(putCalls()).toHaveLength(1)

      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          pendingLimits: { tokensPerMinute: 2000, requestsPerMinute: 120 }
        })
      })
      const page = await get(INFRADEV_URL, mergeCookies(jar, confirmed))
      const $ = load(page.result)

      expect($('[data-testid="team-notification"]').text()).toContain(
        'The limits in Infradev are being changed'
      )
      expect($('[data-testid="limits-pending"]').text().trim()).toBe(
        'Changing to 2,000 tokens and 120 requests a minute'
      )
    })

    test('treats a replayed key (200) as the same request, not a second one', async () => {
      const jar = await answered()

      backend({
        [`PUT ${LIMITS_PATH}`]: reply(200, {
          operation: openOperation({ id: 'op-limits-1' })
        })
      })

      const confirmed = await post(CHECK_URL, {}, jar)

      expect(confirmed.statusCode).toBe(statusCodes.seeOther)
      expect(confirmed.headers.location).toBe(INFRADEV_URL)
    })

    test('sends the same key again when asked again after a failure, so the backend makes one change', async () => {
      const jar = await answered()
      const keys = []

      backend({
        [`PUT ${LIMITS_PATH}`]: (request) => {
          keys.push(request.headers.get('idempotency-key'))

          return keys.length === 1
            ? reply(502, { code: 'upstream-unavailable' })
            : reply(200, { operation: openOperation() })
        }
      })

      const first = await post(CHECK_URL, {}, jar)

      expect(first.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(load(first.result), '.govuk-error-summary')).toContain(
        'We could not change the limits just now'
      )

      const retried = await post(CHECK_URL, {}, mergeCookies(jar, first))

      expect(retried.statusCode).toBe(statusCodes.seeOther)
      expect(keys).toHaveLength(2)
      expect(keys[1]).toBe(keys[0])
    })

    test('uses a new key when the answers change', async () => {
      const first = await answered({ tokensPerMinute: '2000' })
      const keys = []

      backend({
        [`PUT ${LIMITS_PATH}`]: (request) => {
          keys.push(request.headers.get('idempotency-key'))

          return reply(202, { operation: openOperation() })
        }
      })

      await post(CHECK_URL, {}, first)

      const second = mergeCookies(
        first,
        await post(
          LIMITS_URL,
          {
            tokensPerMinute: '2500',
            requestsPerMinute: '120'
          },
          first
        )
      )

      await post(CHECK_URL, {}, second)

      expect(keys).toHaveLength(2)
      expect(keys[1]).not.toBe(keys[0])
    })

    test('does not ask the backend a second time once it has been confirmed and shown', async () => {
      const jar = await answered()

      backend({
        [`PUT ${LIMITS_PATH}`]: reply(202, { operation: openOperation() })
      })

      const confirmed = await post(CHECK_URL, {}, jar)
      const again = await post(CHECK_URL, {}, mergeCookies(jar, confirmed))

      expect(again.statusCode).toBe(statusCodes.seeOther)
      expect(again.headers.location).toBe(LIMITS_URL)
      expect(putCalls()).toHaveLength(1)
    })

    test('sends the person back to the question, with the bounds, when the backend says they are outside', async () => {
      const jar = await answered({ tokensPerMinute: '4000' })

      backend({
        [`PUT ${LIMITS_PATH}`]: reply(400, {
          code: 'limits-out-of-bounds',
          message: 'No',
          limitBounds: {
            tokensPerMinute: { min: 1, max: 3000 },
            requestsPerMinute: BOUNDS.requestsPerMinute
          }
        })
      })

      const response = await post(CHECK_URL, {}, jar)
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(text($, '.govuk-error-summary')).toContain(
        'Tokens a minute must be between 1 and 3,000'
      )
      expect($('#tokensPerMinute').attr('value')).toBe('4000')
    })

    test('says the team already has these limits, keeping the answers, when the backend says so', async () => {
      const jar = await answered({
        tokensPerMinute: '1000',
        requestsPerMinute: '60'
      })

      backend({
        [`PUT ${LIMITS_PATH}`]: reply(409, {
          code: 'limits-unchanged',
          message: 'No'
        })
      })

      const response = await post(CHECK_URL, {}, jar)
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, '.govuk-error-summary')).toContain(
        'Your team already has these limits in Infradev'
      )
    })

    test.each([
      [
        'environment-not-set-up',
        409,
        'Infradev is not set up yet, so it has no limits to change.'
      ],
      [
        'admin-required',
        403,
        'Only a team admin can change the limits in Infradev.'
      ],
      [
        'idempotency-key-reused',
        409,
        'Something changed since you checked these limits. Check your answers again.'
      ]
    ])('explains %s in words', async (code, status, message) => {
      const jar = await answered()

      backend({
        [`PUT ${LIMITS_PATH}`]: reply(status, { code, message: 'No' })
      })

      const response = await post(CHECK_URL, {}, jar)

      expect(response.statusCode).toBe(status)
      expect(text(load(response.result), 'main')).toContain(message)
    })

    test('is 404 for a person who is no longer a member', async () => {
      const jar = await answered()

      backend({ [`PUT ${LIMITS_PATH}`]: NOT_MEMBER })

      const response = await post(CHECK_URL, {}, jar)

      expect(response.statusCode).toBe(statusCodes.notFound)
    })

    test('says it could not make the change, keeping the answers for a retry, when the backend fails', async () => {
      const jar = await answered()

      backend({
        [`PUT ${LIMITS_PATH}`]: reply(500, { code: 'internal-error' })
      })

      const response = await post(CHECK_URL, {}, jar)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(load(response.result), 'main')).toContain('2,000')
    })

    test('is 403 for a member, and asks the backend for nothing', async () => {
      const jar = await answered()

      backend({ role: 'user' })

      const response = await post(CHECK_URL, {}, jar)

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(putCalls()).toHaveLength(0)
    })
  })
})

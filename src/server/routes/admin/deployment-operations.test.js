import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  cookieHeader,
  mergeCookies,
  signInViaOidc
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

const DETAIL = '/v1/admin/team-deployments/team-1/infradev'
const PAGE = '/admin/deployments/team-1/infradev'

function answer(status, code) {
  return reply(status, { statusCode: status, code, message: 'Refused' })
}

function detail() {
  return {
    team: {
      id: 'team-1',
      name: 'Flood Risk Team',
      status: 'active',
      memberCount: 3
    },
    environment: 'infradev',
    status: 'needs-attention',
    credential: { status: 'active' },
    federations: [
      {
        id: 'f1',
        name: 'beta-api',
        host: 'cdp',
        status: 'failed',
        operationId: 'op-f1',
        retryable: true
      }
    ],
    limitsOperation: {
      id: 'op-l1',
      state: 'deploy-failed',
      failureReason: null,
      updatedAt: '2026-10-30T16:00:00.000Z',
      retryable: true
    },
    deployments: [],
    environments: []
  }
}

describe('#admin Retry and Reconcile a change by its operation', () => {
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

  function get(url, jar = cookies) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(jar) }
    })
  }

  function post(url, jar = cookies) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(jar) },
      payload: { crumb: jar.crumb }
    })
  }

  function follow(response) {
    return get(
      response.headers.location,
      mergeCookies({ ...cookies }, response)
    )
  }

  // What was sent to the backend that changes anything.
  function writes() {
    return fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .filter(([url]) => new URL(url).pathname.startsWith('/v1/admin'))
      .map(([url]) => `POST ${new URL(url).pathname}`)
  }

  describe('requesting', () => {
    test.each([
      [
        'Retry',
        'retry',
        'op-f1',
        'Retry requested for beta-api. The table shows where it is.'
      ],
      [
        'Reconcile',
        'reconcile',
        'op-f1',
        'Reconcile requested for beta-api. The table shows where it is.'
      ],
      [
        'Retry of the limits change',
        'retry',
        'op-l1',
        'Retry requested for the limits change. The table shows where it is.'
      ],
      [
        'Reconcile of the limits change',
        'reconcile',
        'op-l1',
        'Reconcile requested for the limits change. The table shows where it is.'
      ]
    ])(
      '%s calls the backend for the operation, returns to the page and says so',
      async (_name, action, operationId, message) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail(),
          [`POST /v1/admin/operations/${operationId}/${action}`]: reply(202, {
            operation: { id: operationId, state: 'deploying' }
          })
        })

        const response = await post(
          `${PAGE}/operations/${operationId}/${action}`
        )
        const page = load((await follow(response)).result)

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(PAGE)
        expect(writes()).toEqual([
          `POST /v1/admin/operations/${operationId}/${action}`
        ])
        expect(
          page('[data-testid="team-notification"]').text().replace(/\s+/g, ' ')
        ).toContain(message)
      }
    )

    test('does not call the backend for an operation that is not one of the page’s, whatever the address says', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await post(
        `${PAGE}/operations/op-99/reconcile`
      )

      expect(statusCode).toBe(statusCodes.notFound)
      expect(load(result)('h1').text()).toBe('Deployment not found')
      expect(writes()).toEqual([])
    })
  })

  describe('what the backend refuses or cannot do', () => {
    test('says on the page, with a link to the application, that a change that cannot be retried cannot be', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/operations/op-f1/retry': answer(
          409,
          'operation-not-retryable'
        )
      })

      const { statusCode, result } = await post(
        `${PAGE}/operations/op-f1/retry`
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.conflict)
      expect($('title').text()).toContain(
        'Error: Flood Risk Team in Development'
      )
      expect($('.govuk-error-summary a').text()).toBe(
        'beta-api cannot be retried in its current state'
      )
      expect($('.govuk-error-summary a').attr('href')).toBe(
        '#federated-credentials'
      )
      expect($('h1').text()).toBe('Flood Risk Team')
    })

    test('says the same for the limits change, with a link to the health table', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/operations/op-l1/retry': answer(
          409,
          'operation-not-retryable'
        )
      })

      const { statusCode, result } = await post(
        `${PAGE}/operations/op-l1/retry`
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.conflict)
      expect($('.govuk-error-summary a').text()).toBe(
        'The limits change cannot be retried in its current state'
      )
      expect($('.govuk-error-summary a').attr('href')).toBe('#health')
    })

    test('says a change the backend no longer finds could not be done, on the page', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/operations/op-f1/reconcile': answer(
          404,
          'operation-not-found'
        )
      })

      const { statusCode, result } = await post(
        `${PAGE}/operations/op-f1/reconcile`
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.notFound)
      expect($('.govuk-error-summary a').text()).toBe(
        'Reconcile could not be done for beta-api: its change is no longer there. Check the table and try again'
      )
      expect($('h1').text()).toBe('Flood Risk Team')
    })

    test('says another refusal could not be done in its current state', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/operations/op-f1/reconcile': answer(409, 'busy')
      })

      const { statusCode, result } = await post(
        `${PAGE}/operations/op-f1/reconcile`
      )

      expect(statusCode).toBe(statusCodes.conflict)
      expect(load(result)('.govuk-error-summary a').text()).toBe(
        'Reconcile could not be done for beta-api in its current state. Check the table and try again'
      )
    })

    test('shows the error page when the dispatch fails', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        'POST /v1/admin/operations/op-f1/retry': answer(
          502,
          'upstream-unavailable'
        )
      })

      const { statusCode, result } = await post(
        `${PAGE}/operations/op-f1/retry`
      )

      expect(statusCode).toBe(statusCodes.badGateway)
      expect(load(result)('h1').text()).toBe('We could not load this page')
    })

    test('shows the 403 page for a person who is not a Platform Admin, and calls nothing', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: answer(403, 'platform-admin-required')
      })

      const { statusCode } = await post(`${PAGE}/operations/op-f1/retry`)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(writes()).toEqual([])
    })

    test('refuses a post with no crumb', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode } = await server.inject({
        method: 'POST',
        url: `${PAGE}/operations/op-f1/retry`,
        headers: { cookie: cookieHeader(cookies) },
        payload: {}
      })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(writes()).toEqual([])
    })
  })
})

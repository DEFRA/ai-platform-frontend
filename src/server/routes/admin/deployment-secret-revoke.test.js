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
const REVOKE_API = `${DETAIL}/credentials/s1/revoke`
const PAGE = '/admin/deployments/team-1/infradev'
const REVOKE = `${PAGE}/credentials/s1/revoke`
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const REASON = 'Spotted at <b>jo.smith@defra.gov.uk</b> misusing it'
// A made-up form identifier (a version 4 UUID), not a secret.
const FORM_ID = 'c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b' // gitleaks:allow

function answer(status, code) {
  return reply(status, { statusCode: status, code, message: 'Refused' })
}

function detail(secrets) {
  return {
    team: {
      id: 'team-1',
      name: 'Flood Risk Team',
      status: 'active',
      memberCount: 3
    },
    environment: 'infradev',
    status: 'ready',
    credential: { status: 'active' },
    clientSecrets: {
      allowed: true,
      used: 2,
      limit: 3,
      items: secrets ?? [
        { id: 's1', keyHint: 'a1b2', expiresAt: null, status: 'active' },
        { id: 's2', keyHint: 'e5f6', expiresAt: null, status: 'expired' }
      ]
    },
    federations: [],
    deployments: [],
    environments: []
  }
}

describe('#admin revoke one client secret', () => {
  let server
  let cookies
  let logged

  beforeAll(async () => {
    server = await createServer()
    // Everything the app could write to its log for a request, to prove the
    // reason is never in it (the reason is in its audit event only).
    server.events.on(
      { name: 'request', channels: ['app', 'error', 'internal'] },
      (_request, event) => logged.push(event)
    )
    server.ext('onRequest', (request, h) => {
      for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
        request.logger[level] = (...args) => logged.push(args)
      }

      return h.continue
    })
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    logged = []
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

  function post(url, payload = {}, jar = cookies) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(jar) },
      payload: { crumb: jar.crumb, ...payload }
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
      .map(([url, init]) => ({
        path: new URL(url).pathname,
        body: init.body ? JSON.parse(init.body) : undefined,
        key: init.headers['idempotency-key']
      }))
  }

  function text(element) {
    return element.text().replace(/\s+/g, ' ').trim()
  }

  describe('the reason page', () => {
    test('redirects a signed out person to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: REVOKE
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toContain('/sign-in')
    })

    test('names the secret by the end of its key, says it cannot be undone and that the other secrets stay, with a red button, a form key and Cancel', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode, result } = await get(REVOKE)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text()).toBe('Revoke the secret ending a1b2')
      expect($('title').text()).toContain(
        'Revoke the secret ending a1b2 - Flood Risk Team - Admin'
      )
      expect(text($('[data-testid="credentials-effect"]'))).toBe(
        'Revoking cannot be undone. No new token can be made with this secret. A token already issued with it keeps working until it expires, up to 2 hours. To stop calls now, also use Disable credentials on this deployment. The team’s other secrets are not changed. The team is not told why.'
      )
      expect(text($('[data-testid="credentials-effect"]'))).not.toContain(
        'stops working'
      )
      expect(text($('[data-testid="credentials-submit"]'))).toBe(
        'Revoke secret'
      )
      expect($('[data-testid="credentials-submit"]').attr('class')).toContain(
        'govuk-button--warning'
      )
      expect($('input[name="formKey"]').attr('value')).toMatch(UUID_V4)
      expect($('main input[name="crumb"]')).toHaveLength(1)
      expect($('[data-testid="credentials-cancel"]').attr('href')).toBe(PAGE)
      expect($('.govuk-back-link').attr('href')).toBe(PAGE)
      expect(writes()).toEqual([])
    })

    test.each([
      ['an expired secret', 's2'],
      ['a secret the deployment does not hold', 'nope']
    ])(
      'sends %s back to the deployment, which says it is not available',
      async (_name, id) => {
        mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

        const response = await get(`${PAGE}/credentials/${id}/revoke`)
        const page = load((await follow(response)).result)

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(PAGE)
        expect(text(page('[data-testid="team-notification"]'))).toContain(
          'That secret is not available to revoke.'
        )
      }
    )

    test('shows the 403 page when the backend refuses the person, and changes nothing', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: answer(403, 'platform-admin-required')
      })

      const { statusCode, result } = await post(REVOKE, { reason: 'Leaked' })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(load(result)('h1').text()).toBe(
        'Only a Platform Admin can use this page'
      )
      expect(writes()).toEqual([])
    })

    test('shows the 404 page for a deployment the backend does not have', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: answer(404, 'deployment-not-found')
      })

      const { statusCode, result } = await get(REVOKE)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(load(result)('h1').text()).toBe('Deployment not found')
    })
  })

  describe('revoking', () => {
    test('sends the reason for that one secret with a key of its own, and says it was revoked on the deployment', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${REVOKE_API}`]: {
          environment: 'infradev',
          credentialId: 's1',
          revoked: true
        }
      })

      const response = await post(REVOKE, {
        reason: `  ${REASON}  `,
        formKey: FORM_ID
      })
      const sent = writes()
      const page = load((await follow(response)).result)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)
      expect(sent).toEqual([
        {
          path: REVOKE_API,
          body: { reason: REASON },
          key: expect.stringMatching(UUID_V4)
        }
      ])
      expect(text(page('[data-testid="team-notification"]'))).toContain(
        'Revoked the secret ending a1b2.'
      )
    })

    test('says it was already revoked when the backend revoked nothing', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${REVOKE_API}`]: {
          environment: 'infradev',
          credentialId: 's1',
          revoked: false
        }
      })

      const response = await post(REVOKE, { reason: 'Leaked' })
      const page = load((await follow(response)).result)

      expect(text(page('[data-testid="team-notification"]'))).toContain(
        'The secret ending a1b2 was already revoked.'
      )
    })

    test('sends the same key when the same form is sent again with the same reason, and another for another reason', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${REVOKE_API}`]: {}
      })

      await post(REVOKE, { formKey: FORM_ID, reason: 'One reason' })
      await post(REVOKE, { formKey: FORM_ID, reason: 'One reason' })
      await post(REVOKE, { formKey: FORM_ID, reason: 'Another reason' })

      const [first, again, other] = writes().map(({ key }) => key)

      expect(again).toBe(first)
      expect(other).not.toBe(first)
    })

    test.each([
      ['an empty reason', ''],
      ['a reason of only spaces', '   '],
      ['a reason over 500 characters', 'x'.repeat(501)]
    ])(
      'refuses %s on the reason field and revokes nothing',
      async (_n, reason) => {
        mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

        const { statusCode, result } = await post(REVOKE, { reason })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('title').text().trim()).toMatch(/^Error: /)
        expect($('.govuk-error-summary a').attr('href')).toBe('#reason')
        expect(writes()).toEqual([])
      }
    )

    test.each([
      ['reason-required', 'Enter a reason'],
      ['reason-too-long', 'Reason must be 500 characters or fewer']
    ])(
      'puts a %s the backend gives on the reason field',
      async (code, message) => {
        mockApi(fetchMock, {
          [`GET ${DETAIL}`]: detail(),
          [`POST ${REVOKE_API}`]: answer(400, code)
        })

        const { statusCode, result } = await post(REVOKE, { reason: 'Leaked' })

        expect(statusCode).toBe(statusCodes.badRequest)
        expect(load(result)('.govuk-error-summary a').text()).toBe(message)
      }
    )

    test('sends the person back to the deployment, with a notice, when the backend no longer finds the secret', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${REVOKE_API}`]: answer(404, 'credential-not-found')
      })

      const response = await post(REVOKE, { reason: 'Leaked' })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(PAGE)
    })

    test('says it could not revoke the secret, and offers Try again, when the backend fails, without the reason in the page or any log', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${REVOKE_API}`]: answer(502, 'upstream-unavailable')
      })

      const { statusCode, result } = await post(REVOKE, { reason: REASON })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badGateway)
      expect($('h1').text()).toBe('We could not revoke the secret ending a1b2')
      expect($('[data-testid="credentials-retry"]').attr('href')).toBe(REVOKE)
      expect(result).not.toContain('misusing')
      expect(JSON.stringify(logged)).not.toContain('jo.smith')
      expect(JSON.stringify(logged)).not.toContain('misusing')
    })

    test('lets the 403 of a person who lost the role through to the 403 page, and revokes nothing', async () => {
      mockApi(fetchMock, {
        [`GET ${DETAIL}`]: detail(),
        [`POST ${REVOKE_API}`]: answer(403, 'platform-admin-required')
      })

      const { statusCode, result } = await post(REVOKE, { reason: 'Leaked' })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(load(result)('h1').text()).toBe(
        'Only a Platform Admin can use this page'
      )
    })

    test('refuses a post with no crumb, and changes nothing', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const { statusCode } = await server.inject({
        method: 'POST',
        url: REVOKE,
        headers: { cookie: cookieHeader(cookies) },
        payload: { reason: 'Leaked' }
      })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(writes()).toEqual([])
    })

    test('does not revoke a secret that is not active, whatever is posted', async () => {
      mockApi(fetchMock, { [`GET ${DETAIL}`]: detail() })

      const response = await post(`${PAGE}/credentials/s2/revoke`, {
        reason: 'Leaked'
      })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(writes()).toEqual([])
    })
  })
})

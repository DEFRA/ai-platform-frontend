import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  signInViaOidc,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import { sampleTeam } from '#/test-helpers/team-connect-helpers.js'

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
    claims: () => ({
      preferred_username: 'test.user@defra.gov.uk',
      email: 'test.user@defra.gov.uk',
      name: 'Test User'
    })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const URL_PATH = `/teams/${sampleTeam.slug}/members/add/people`
const SEARCH_PATH = `/v1/teams/${sampleTeam.slug}/people/search`
const sam = {
  oid: '0b8f6f4e-3c0f-4c46-9c58-2d3a8d2f1a11',
  displayName: 'Sam Carter',
  email: 'sam.carter@defra.gov.uk'
}

describe('#people search route', () => {
  let server
  let cookies
  let logged

  beforeAll(async () => {
    server = await createServer()
    // Everything the app could write to its log for a request, to prove the
    // search text is never in it.
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
    cookies = await signInViaOidc(server, fetchMock)
  })

  function search(payload, { jar = cookies, crumb = jar.crumb } = {}) {
    return server.inject({
      method: 'POST',
      url: URL_PATH,
      headers: {
        cookie: cookieHeader(jar),
        'content-type': 'application/json',
        ...(crumb ? { 'x-csrf-token': crumb } : {})
      },
      payload: JSON.stringify(payload)
    })
  }

  function searchesMade() {
    return fetchMock.mock.calls.filter(([url]) =>
      url.includes('/people/search')
    )
  }

  test('answers with the matches the backend found, as the signed-in admin, and never caches them', async () => {
    mockApi(fetchMock, {
      [`POST ${SEARCH_PATH}`]: {
        items: [{ ...sam, userId: 'internal', upn: 'sam@defra.gov.uk' }]
      }
    })

    const response = await search({ search: '  sam ' })

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(response.payload)).toEqual({ items: [sam] })

    const [[, options]] = searchesMade()

    expect(JSON.parse(options.body)).toEqual({ search: 'sam' })
    expect(options.headers['x-user-id']).toBe('user-1')
  })

  test('answers with no matches as an empty list', async () => {
    mockApi(fetchMock, { [`POST ${SEARCH_PATH}`]: { items: [] } })

    const response = await search({ search: 'zzz' })

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(JSON.parse(response.payload)).toEqual({ items: [] })
  })

  test.each([
    ['nothing', {}],
    ['one character', { search: 'a' }],
    ['spaces around one character', { search: '  a ' }],
    ['more than 100 characters', { search: 'x'.repeat(101) }],
    ['text that is not text', { search: ['sam'] }],
    ['something unexpected as well', { search: 'sam', extra: true }]
  ])(
    'refuses %s with a 400 and a message, and searches for no one',
    async (_name, payload) => {
      const response = await search(payload)

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(JSON.parse(response.payload)).toEqual({
        message: 'Enter 2 to 100 characters of a name or email address'
      })
      expect(searchesMade()).toHaveLength(0)
    }
  )

  test('tells a member who is not an admin that they cannot, with a 403', async () => {
    mockApi(fetchMock, {
      [`POST ${SEARCH_PATH}`]: reply(403, { code: 'admin-required' })
    })

    const response = await search({ search: 'sam' })

    expect(response.statusCode).toBe(statusCodes.forbidden)
    expect(JSON.parse(response.payload)).toEqual({
      message: 'Only an admin of this team can search for people'
    })
  })

  test('answers 404 for a team the person is not in', async () => {
    mockApi(fetchMock, {
      [`POST ${SEARCH_PATH}`]: reply(404, { code: 'not-found' })
    })

    const response = await search({ search: 'sam' })

    expect(response.statusCode).toBe(statusCodes.notFound)
    expect(JSON.parse(response.payload)).toEqual({
      message: 'This team does not exist, or you are not a member'
    })
  })

  test.each([
    [
      'the directory is not available',
      reply(503, { code: 'directory-unavailable' })
    ],
    ['the backend cannot be reached', reply(502, { code: 'bad-gateway' })],
    ['the backend fails', reply(500, { code: 'internal' })]
  ])('answers 503 with a message when %s', async (_name, answer) => {
    mockApi(fetchMock, { [`POST ${SEARCH_PATH}`]: answer })

    const response = await search({ search: 'sam' })

    expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
    expect(JSON.parse(response.payload)).toEqual({
      message: 'We could not search the directory. Try again in a few minutes'
    })
  })

  test('fails on a fault of its own rather than blaming the directory', async () => {
    fetchMock.mockResponse('not json')

    const response = await search({ search: 'sam' })

    expect(response.statusCode).toBe(statusCodes.internalServerError)
  })

  test('answers 401 as JSON when signed out, so the page can send the person to sign in', async () => {
    const response = await search(
      { search: 'sam' },
      { jar: { crumb: cookies.crumb } }
    )

    expect(response.statusCode).toBe(statusCodes.unauthorized)
    expect(JSON.parse(response.payload)).toEqual({
      message: 'Sign in to search for people'
    })
    expect(searchesMade()).toHaveLength(0)
  })

  test.each([
    ['no CSRF header', { crumb: '' }],
    ['a wrong CSRF header', { crumb: 'not-the-crumb' }]
  ])(
    'refuses a request with %s, and searches for no one',
    async (_name, options) => {
      const response = await search({ search: 'sam' }, options)

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(searchesMade()).toHaveLength(0)
    }
  )

  test('refuses the crumb in the body in place of the header', async () => {
    const response = await server.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { cookie: cookieHeader(cookies) },
      payload: { search: 'sam', crumb: cookies.crumb }
    })

    expect(response.statusCode).toBe(statusCodes.forbidden)
    expect(searchesMade()).toHaveLength(0)
  })

  test.each([
    ['a match', { items: [sam] }],
    ['a refusal', reply(403, { code: 'admin-required' })],
    ['an unavailable directory', reply(503, { code: 'directory-unavailable' })],
    ['a search that is too long', undefined]
  ])(
    'never writes the search text to the log, for %s',
    async (_name, answer) => {
      const text = 'secret-name-fragment'

      mockApi(fetchMock, answer ? { [`POST ${SEARCH_PATH}`]: answer } : {})

      await search({ search: answer ? text : text + 'x'.repeat(100) })
      await search({ search: text }, { jar: { crumb: cookies.crumb } })

      expect(JSON.stringify(logged)).not.toContain(text)
      expect(JSON.stringify(logged)).not.toContain('sam.carter')
    }
  )
})

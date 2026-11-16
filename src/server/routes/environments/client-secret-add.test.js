import { randomUUID } from 'node:crypto'

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
  clientSecretItem,
  clientSecretsOf,
  detail,
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

const ADD_URL = `${INFRADEV_URL}/client-secrets/add`
const ADDED_URL = `${INFRADEV_URL}/client-secrets/added`
const ADD_PATH = `${TEAM_PATH}/environments/infradev/client-secrets`
const SECRET = 'cs_live_9f8e7d6c5b4a39281706f5e4d3c2b1a0'
const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const NOT_MEMBER = reply(404, { code: 'not-a-member', message: 'Not found' })
const ADDED = {
  credential: {
    id: 'cred-9',
    keyHint: 'b1c2',
    expiresAt: '2027-02-14T00:00:00.000Z',
    environment: 'infradev'
  },
  secret: SECRET
}
const REPLAY = { credential: ADDED.credential }

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('#clientSecretAddController', () => {
  let server
  let cookies
  let logged
  let watching = false
  const configured = config.get('teamEnvironments')

  beforeAll(async () => {
    server = await createServer()

    // Call-through spies on every request's real logger.
    server.ext('onRequest', (request, h) => {
      if (watching) {
        for (const level of ['info', 'warn', 'error', 'debug']) {
          const original = request.logger[level].bind(request.logger)

          request.logger[level] = (...args) => {
            logged.push(args)

            return original(...args)
          }
        }
      }

      return h.continue
    })

    await server.initialize()
  })

  afterAll(async () => {
    config.set('teamEnvironments', configured)
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    fetchMock.resetMocks()
    logged = []
    cookies = await signInViaOidc(server, fetchMock)
  })

  afterEach(() => {
    watching = false
    config.set('teamEnvironments', configured)
  })

  function backend({ role = 'admin', environment = {}, ...routes } = {}) {
    mockApi(fetchMock, {
      'GET /v1/teams': { items: [sampleTeam] },
      'GET /v1/models': { items: [sampleModel] },
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${TEAM_PATH}/environments/infradev`]: detail({
        clientSecrets: clientSecretsOf([clientSecretItem()]),
        ...environment
      }),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      [`POST ${ADD_PATH}`]: reply(201, ADDED),
      'GET /v1/credentials/cred-9': {
        _id: 'cred-9',
        tier: 'team',
        teamId: 'team-1',
        environment: 'infradev',
        issuerKey: 'entra'
      },
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

  function post(url, payload, jar = cookies) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(jar) },
      payload: { crumb: jar.crumb, ...payload }
    })
  }

  // What a person's browser does: the confirmation page, and the key it shows.
  async function shownKey(jar = cookies) {
    const response = await get(ADD_URL, jar)

    return load(response.result)('input[name="key"]').attr('value')
  }

  // The adds sent to the backend.
  function addCalls() {
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        init?.method === 'POST' && url.includes('/client-secrets')
    )
  }

  function keySent(call) {
    return call[1].headers['idempotency-key']
  }

  // An admin adds a client secret: the form, then its post.
  async function added() {
    const key = await shownKey()
    const response = await post(ADD_URL, { key })

    return { response, key, jar: mergeCookies({ ...cookies }, response) }
  }

  describe(`GET ${ADD_URL}`, () => {
    test('tells an admin what will happen, with a form that posts a key and the CSRF token', async () => {
      backend()

      const { statusCode, result } = await get(ADD_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(text($, 'h1')).toBe('Add a client secret in Infradev')
      expect(text($, '[data-testid="app-heading-caption"]')).toBe(
        'Flood Risk Team'
      )
      expect($('title').text()).toContain('Add a client secret in Infradev')
      expect(text($, '[data-testid="client-secret-add-facts"]')).toContain(
        'It stops working after at most three months.'
      )
      expect(text($, '[data-testid="client-secret-add-facts"]')).toContain(
        'It is shown once'
      )
      expect(text($, '[data-testid="client-secret-add-facts"]')).toContain(
        '1 of 3 client secrets in use in Infradev.'
      )
      expect($('a.govuk-back-link').attr('href')).toBe(INFRADEV_URL)
      expect($('main a:contains("Cancel")').attr('href')).toBe(INFRADEV_URL)
      expect($('main form').attr('method')).toBe('post')
      expect($('main form').attr('action')).toBe(ADD_URL)
      expect($('main form input[name="crumb"]')).toHaveLength(1)
      expect($('main form input[name="key"]').attr('value')).toMatch(
        KEY_PATTERN
      )
      expect(text($, '#add-client-secret')).toBe('Add a client secret')
    })

    test('asks for an optional name, with a hint, and nothing in it yet', async () => {
      backend()

      const { result } = await get(ADD_URL)
      const $ = load(result)

      expect(text($, 'label[for="name"]')).toBe('Name (optional)')
      expect(text($, '#name-hint')).toBe(
        'A short name so you can tell your secrets apart, for example local-dev. Up to 30 characters: letters, numbers, spaces, hyphens, underscores and full stops.'
      )
      expect($('input#name').attr('name')).toBe('name')
      expect($('input#name').attr('type')).toBe('text')
      expect($('input#name').attr('value')).toBeUndefined()
      expect($('input#name').attr('aria-describedby')).toBe('name-hint')
      expect($('.govuk-error-summary')).toHaveLength(0)
    })

    test('gives each showing of the form a key of its own', async () => {
      backend()

      const first = await shownKey()
      const second = await shownKey()

      expect(first).not.toBe(second)
    })

    test('is 403 for a member, who is offered nothing to add', async () => {
      backend({ role: 'user' })

      const { statusCode, result } = await get(ADD_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(text($, 'h1')).toBe('You cannot add a client secret')
      expect(text($, 'main')).toContain(
        'Only a team admin can add a client secret in Infradev.'
      )
      expect($('main form')).toHaveLength(0)
    })

    test('is 404 for a person who is not a member, with nothing about the team', async () => {
      backend({ [`GET ${TEAM_PATH}/environments/infradev`]: NOT_MEMBER })

      const { statusCode, result } = await get(ADD_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(text(load(result), 'main')).not.toContain('Flood Risk Team')
    })

    test('is 404 for an environment the backend does not offer', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: reply(404, {
          code: 'environment-not-available'
        })
      })

      const { statusCode, result } = await get(ADD_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(text(load(result), 'h1')).toBe('Environment not found')
    })

    test.each(['qa', 'nowhere'])(
      'is 404 for %s, which is not an available environment',
      async (code) => {
        backend()

        const { statusCode } = await get(
          `/environments/${sampleTeam.slug}/${code}/client-secrets/add`
        )

        expect(statusCode).toBe(statusCodes.notFound)
      }
    )

    test.each([
      [
        'where client secrets are not allowed',
        clientSecretsOf([], { allowed: false }),
        {},
        'You cannot add a client secret in Infradev',
        'Client secrets are not available in Infradev. Applications there use a passwordless credential.'
      ],
      [
        'where the environment is not set up',
        clientSecretsOf([]),
        { setUp: false, limits: null, limitBounds: null, models: [] },
        'Infradev is not set up yet',
        'Deploy a model in Infradev first.'
      ],
      [
        'when the limit is reached',
        clientSecretsOf([
          clientSecretItem(),
          clientSecretItem({ id: 'cred-2' }),
          clientSecretItem({ id: 'cred-3' })
        ]),
        {},
        'Infradev has the most client secrets it can',
        'Revoke one, or wait for one to expire, to add another.'
      ]
    ])(
      'is 409, with no form, %s',
      async (_name, clientSecrets, environment, heading, message) => {
        backend({ environment: { clientSecrets, ...environment } })

        const { statusCode, result } = await get(ADD_URL)
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.conflict)
        expect(text($, 'h1')).toBe(heading)
        expect(text($, 'main')).toContain(message)
        expect($('main form')).toHaveLength(0)
        expect(
          $('main a[href="/environments/flood-risk-team/infradev"]')
        ).not.toHaveLength(0)
      }
    )

    test('says it could not read the environment when the backend is unavailable', async () => {
      backend({
        [`GET ${TEAM_PATH}/environments/infradev`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { statusCode, result } = await get(ADD_URL)

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(load(result), 'main')).toContain(
        'We could not read Infradev just now.'
      )
    })

    test('redirects to sign in when signed out', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: ADD_URL
      })

      expect(statusCode).toBe(statusCodes.found)
    })
  })

  describe(`POST ${ADD_URL}`, () => {
    test('asks the backend for one client secret with the form’s key as the Idempotency-Key and no body when it has no name, then shows the result', async () => {
      backend()

      const { response, key } = await added()
      const [call] = addCalls()

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(ADDED_URL)
      expect(addCalls()).toHaveLength(1)
      expect(call[0]).toContain(ADD_PATH)
      expect(keySent(call)).toBe(key)
      expect(call[1].body).toBeUndefined()
    })

    test('sends no body when no name is given, or when it is blank', async () => {
      backend()

      for (const name of [undefined, '', '   ']) {
        const key = await shownKey()
        const response = await post(ADD_URL, { key, name })

        expect(response.statusCode).toBe(statusCodes.seeOther)
      }

      expect(addCalls()).toHaveLength(3)
      expect(addCalls().map((call) => call[1].body)).toEqual([
        undefined,
        undefined,
        undefined
      ])
    })

    test('sends the name, trimmed, as the body, and the same key', async () => {
      backend()

      const key = await shownKey()
      const response = await post(ADD_URL, { key, name: '  local-dev  ' })
      const [call] = addCalls()

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(ADDED_URL)
      expect(JSON.parse(call[1].body)).toEqual({ name: 'local-dev' })
      expect(keySent(call)).toBe(key)
    })

    test('accepts 30 characters of letters, numbers, spaces, hyphens, underscores and full stops', async () => {
      backend()

      const name = 'a1 _.-'.repeat(5)
      const response = await post(ADD_URL, {
        key: await shownKey(),
        name
      })

      expect(name).toHaveLength(30)
      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(JSON.parse(addCalls()[0][1].body)).toEqual({ name })
    })

    test.each([
      [
        'more than 30 characters',
        'a'.repeat(31),
        'Name must be 30 characters or fewer'
      ],
      [
        'a character that is not allowed',
        'dev/<b>',
        'Name must only include letters, numbers, spaces, hyphens, underscores and full stops'
      ],
      [
        'an accented letter',
        'café',
        'Name must only include letters, numbers, spaces, hyphens, underscores and full stops'
      ],
      [
        'two names',
        ['a', 'b'],
        'Name must only include letters, numbers, spaces, hyphens, underscores and full stops'
      ]
    ])(
      'shows the form again, with an error summary, an inline error and the name kept, for %s, and asks the backend for nothing',
      async (_label, name, message) => {
        backend()

        const key = await shownKey()
        const response = await post(ADD_URL, { key, name })
        const $ = load(response.result)

        expect(response.statusCode).toBe(statusCodes.badRequest)
        expect($('title').text()).toContain('Error: Add a client secret')
        expect(text($, '.govuk-error-summary')).toContain(message)
        expect($('.govuk-error-summary a').attr('href')).toBe('#name')
        expect(text($, '#name-error')).toBe(`Error: ${message}`)
        expect($('input#name').attr('aria-describedby')).toContain('name-error')
        expect(
          $('input#name').closest('.govuk-form-group--error')
        ).toHaveLength(1)
        expect($('input[name="key"]').attr('value')).toBe(key)

        if (typeof name === 'string') {
          expect($('input#name').attr('value')).toBe(name)
        }

        expect(addCalls()).toHaveLength(0)
      }
    )

    test('shows the form again with the same name, and an error, when the backend is unavailable', async () => {
      backend()

      const key = await shownKey()

      backend({
        [`POST ${ADD_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const response = await post(ADD_URL, { key, name: 'local-dev' })
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect($('input#name').attr('value')).toBe('local-dev')
      expect($('input[name="key"]').attr('value')).toBe(key)
      expect($('input#name').closest('.govuk-form-group--error')).toHaveLength(
        0
      )
    })

    test('does not show a name that is not valid to a member, who is 403', async () => {
      backend({ role: 'member' })

      const response = await post(ADD_URL, {
        key: randomUUID(),
        name: 'a'.repeat(31)
      })

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(addCalls()).toHaveLength(0)
    })

    test('sends the same key when the same form is submitted twice, and another when the form is shown again', async () => {
      backend()

      const key = await shownKey()

      await post(ADD_URL, { key })
      await post(ADD_URL, { key })
      await post(ADD_URL, { key: await shownKey() })

      const keys = addCalls().map(keySent)

      expect(keys[0]).toBe(key)
      expect(keys[1]).toBe(key)
      expect(keys[2]).not.toBe(key)
    })

    test('refuses a post without the CSRF token', async () => {
      backend()

      const response = await server.inject({
        method: 'POST',
        url: ADD_URL,
        headers: { cookie: cookieHeader(cookies) },
        payload: { key: await shownKey() }
      })

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(addCalls()).toHaveLength(0)
    })

    test.each([
      ['no key', {}],
      ['a key that is not a version 4 UUID', { key: 'not-a-key' }],
      ['two keys', { key: ['a', 'b'] }]
    ])(
      'shows the form again, to be given a key, for %s, and asks the backend for nothing',
      async (_name, payload) => {
        backend()

        const response = await post(ADD_URL, payload)

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(ADD_URL)
        expect(addCalls()).toHaveLength(0)
      }
    )

    test.each(['qa', 'nowhere'])(
      'is 404 for %s, which is not an available environment',
      async (code) => {
        backend()

        const { statusCode } = await post(
          `/environments/${sampleTeam.slug}/${code}/client-secrets/add`,
          { key: await shownKey() }
        )

        expect(statusCode).toBe(statusCodes.notFound)
        expect(addCalls()).toHaveLength(0)
      }
    )

    test.each([
      [
        'client-secrets-not-allowed',
        'Client secrets are not available in Infradev. Applications there use a passwordless credential.'
      ],
      [
        'credential-limit-reached',
        'Your team already has the most client secrets it can in Infradev. Revoke one, or wait for one to expire, to add another.'
      ],
      [
        'environment-not-set-up',
        'Deploy a model in Infradev first. You can add a client secret once it is set up.'
      ],
      [
        'admin-required',
        'Only a team admin can add a client secret in Infradev.'
      ],
      [
        'idempotency-key-reused',
        'That request could not be used to add a client secret in Infradev. Try adding it again.'
      ]
    ])(
      'says %s in words, as a banner on the environment’s page',
      async (code, message) => {
        backend({ [`POST ${ADD_PATH}`]: reply(409, { code, message: 'x' }) })

        const { response, jar } = await added()

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(INFRADEV_URL)

        const page = await get(INFRADEV_URL, jar)

        expect(
          text(load(page.result), '[data-testid="team-notification"]')
        ).toContain(message)
        // Said once.
        expect(
          load((await get(INFRADEV_URL, jar)).result)(
            '[data-testid="team-notification"]'
          )
        ).toHaveLength(0)
      }
    )

    test('says a member cannot, when the backend refuses them with 403', async () => {
      backend({
        role: 'user',
        [`POST ${ADD_PATH}`]: reply(403, { code: 'admin-required' })
      })

      // A member is not shown the form, so this is a post made without it.
      const response = await post(ADD_URL, { key: randomUUID() })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(INFRADEV_URL)

      const page = await get(
        INFRADEV_URL,
        mergeCookies({ ...cookies }, response)
      )

      expect(
        text(load(page.result), '[data-testid="team-notification"]')
      ).toContain('Only a team admin can add a client secret in Infradev.')
    })

    test('is 404 for a person who is not a member', async () => {
      backend()

      const key = await shownKey()

      backend({ [`POST ${ADD_PATH}`]: NOT_MEMBER })

      const response = await post(ADD_URL, { key })

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(text(load(response.result), 'h1')).toBe('Team not found')
    })

    test('is 404 when the backend does not offer the environment', async () => {
      backend()

      const key = await shownKey()

      backend({
        [`POST ${ADD_PATH}`]: reply(404, { code: 'environment-not-available' })
      })

      const response = await post(ADD_URL, { key })

      expect(response.statusCode).toBe(statusCodes.notFound)
      expect(text(load(response.result), 'h1')).toBe('Environment not found')
    })

    test('shows the form again with the same key, and an error, when the backend is unavailable, so trying again is the same request', async () => {
      backend()

      const key = await shownKey()

      backend({
        [`POST ${ADD_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const response = await post(ADD_URL, { key })
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect($('title').text()).toContain('Error: Add a client secret')
      expect(text($, '.govuk-error-summary')).toContain(
        'We could not add a client secret just now. Try again in a moment.'
      )
      expect($('.govuk-error-summary a').attr('href')).toBe(
        '#add-client-secret'
      )
      expect($('input[name="key"]').attr('value')).toBe(key)
    })

    test('says it could not read the environment when the form cannot be shown again', async () => {
      backend()

      const key = await shownKey()

      backend({
        [`POST ${ADD_PATH}`]: reply(502, { code: 'upstream-unavailable' }),
        [`GET ${TEAM_PATH}/environments/infradev`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const response = await post(ADD_URL, { key })

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(text(load(response.result), 'main')).toContain(
        'We could not read Infradev just now.'
      )
    })

    test('keeps the key and name when the form cannot be read again, and uses them when the page is opened again, so a request that was made is not made twice', async () => {
      backend()

      const key = await shownKey()

      backend({
        [`POST ${ADD_PATH}`]: reply(502, { code: 'upstream-unavailable' }),
        [`GET ${TEAM_PATH}/environments/infradev`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const timedOut = await post(ADD_URL, { key, name: 'local-dev' })

      expect(timedOut.statusCode).toBe(statusCodes.serviceUnavailable)

      backend()

      const $ = load((await get(ADD_URL)).result)

      expect($('input[name="key"]').attr('value')).toBe(key)
      expect($('input[name="name"]').attr('value')).toBe('local-dev')

      await post(ADD_URL, {
        key: $('input[name="key"]').attr('value'),
        name: $('input[name="name"]').attr('value')
      })
      const [, second] = addCalls()

      expect(keySent(second)).toBe(key)
      expect(JSON.parse(second[1].body)).toEqual({ name: 'local-dev' })
    })

    test('shows the form again with its key when the team is now full, as the request that timed out may be the one that filled the last place', async () => {
      backend()

      const key = await shownKey()

      backend({
        [`POST ${ADD_PATH}`]: reply(502, { code: 'upstream-unavailable' }),
        environment: { clientSecrets: clientSecretsOf([], { used: 3 }) }
      })

      const timedOut = await post(ADD_URL, { key })

      expect(timedOut.statusCode).toBe(statusCodes.serviceUnavailable)

      const again = await get(ADD_URL)

      expect(again.statusCode).toBe(statusCodes.ok)
      expect(load(again.result)('input[name="key"]').attr('value')).toBe(key)
    })

    test('is a refusal, not a form, when the team is full and no add is waiting to be answered', async () => {
      backend({
        environment: { clientSecrets: clientSecretsOf([], { used: 3 }) }
      })

      const { statusCode } = await get(ADD_URL)

      expect(statusCode).toBe(statusCodes.conflict)
    })

    test('does not keep an add the backend refused for good, so the next one has a key of its own', async () => {
      backend()

      const key = await shownKey()

      backend({
        [`POST ${ADD_PATH}`]: reply(409, {
          code: 'credential-limit-reached',
          message: 'x'
        })
      })
      await post(ADD_URL, { key, name: 'local-dev' })

      backend()

      const $ = load((await get(ADD_URL)).result)

      expect($('input[name="key"]').attr('value')).not.toBe(key)
      expect($('input[name="name"]').attr('value')).toBeUndefined()
    })

    test('says why it cannot be added when the backend failed and the environment no longer allows one', async () => {
      backend()

      const key = await shownKey()

      backend({
        [`POST ${ADD_PATH}`]: reply(502, { code: 'upstream-unavailable' }),
        environment: { clientSecrets: clientSecretsOf([], { allowed: false }) }
      })

      const response = await post(ADD_URL, { key })

      expect(response.statusCode).toBe(statusCodes.conflict)
    })

    test('is a fault, not a page, for a refusal it cannot explain', async () => {
      backend({
        [`POST ${ADD_PATH}`]: reply(400, { code: 'validation-error' })
      })

      const { response } = await added()

      expect(response.statusCode).toBe(statusCodes.internalServerError)
    })
  })

  describe(`GET ${ADDED_URL}`, () => {
    test('shows the secret once, with the warning, when it stops working and the next steps, and is never stored', async () => {
      backend()
      watching = true

      const { jar } = await added()
      const response = await get(ADDED_URL, jar)
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(response.headers['cache-control']).toContain('no-store')
      expect(text($, 'h1')).toBe('Client secret added')
      expect(text($, '[data-testid="app-heading-caption"]')).toBe(
        'Flood Risk Team'
      )
      expect(text($, '.govuk-warning-text')).toContain(
        'This client secret is shown once. Copy it now and store it safely.'
      )
      expect(text($, '#client-secret-value')).toBe(SECRET)
      expect(
        $('#client-secret-value')
          .closest('.app-copy-value')
          .find('button[hidden]')
          .attr('data-copy-target')
      ).toBe('client-secret-value')
      expect(text($, '[data-testid="client-secret-added"]')).toContain(
        'Environment Infradev'
      )
      expect(text($, '[data-testid="client-secret-added"]')).toContain(
        'Stops working 14 February 2027'
      )
      expect(text($, '[data-testid="client-secret-next-steps"]')).toContain(
        'It stops working on 14 February 2027. Before then, rotate it or add a new one.'
      )
      expect(
        $('[data-testid="client-secret-next-steps"] a')
          .map((_, link) => $(link).attr('href'))
          .get()
      ).toEqual([
        `${INFRADEV_URL}#client-secret-token`,
        `${INFRADEV_URL}#applications`
      ])
      expect($('main a[href="' + INFRADEV_URL + '"]').text()).toContain(
        'Back to Infradev'
      )
      expect($('[data-testid="placeholder-credential-notice"]')).toHaveLength(0)

      // Gone once shown: not in the session, not on the page it returns to, not in a log.
      const again = await get(ADDED_URL, jar)

      expect(again.statusCode).toBe(statusCodes.seeOther)
      expect(again.headers.location).toBe(INFRADEV_URL)
      expect(
        (await get(INFRADEV_URL, mergeCookies({ ...jar }, again))).result
      ).not.toContain(SECRET)
      expect(JSON.stringify(logged)).not.toContain(SECRET)
    })

    test('shows the name the admin gave the secret, and no name row when it has none', async () => {
      backend({
        [`POST ${ADD_PATH}`]: reply(201, {
          ...ADDED,
          credential: { ...ADDED.credential, name: 'local-dev' }
        })
      })

      const named = await added()
      const namedPage = load((await get(ADDED_URL, named.jar)).result)

      expect(text(namedPage, '[data-testid="client-secret-added"]')).toContain(
        'Name local-dev'
      )
      expect(text(namedPage, '[data-testid="client-secret-added"] dt')).toBe(
        'Client secret Name Environment Stops working'
      )

      backend()

      const unnamed = await added()
      const unnamedPage = load((await get(ADDED_URL, unnamed.jar)).result)

      expect(text(unnamedPage, '[data-testid="client-secret-added"] dt')).toBe(
        'Client secret Environment Stops working'
      )
    })

    test('says it is shown once, and where to see it again, when there is nothing to show', async () => {
      backend()

      const response = await get(ADDED_URL)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(INFRADEV_URL)

      const page = await get(
        INFRADEV_URL,
        mergeCookies({ ...cookies }, response)
      )

      expect(
        text(load(page.result), '[data-testid="team-notification"]')
      ).toContain(
        'A client secret is shown once, when it is added. If you did not copy it, use View on its row to see it again.'
      )
    })

    test('is the secret of the first answer when a double submit made the second a replay, with no value of its own', async () => {
      let calls = 0

      backend({
        [`POST ${ADD_PATH}`]: () =>
          ++calls === 1 ? reply(201, ADDED) : reply(200, REPLAY)
      })

      const key = await shownKey()
      const first = await post(ADD_URL, { key })
      const second = await post(
        ADD_URL,
        { key },
        mergeCookies({ ...cookies }, first)
      )

      expect(second.statusCode).toBe(statusCodes.seeOther)
      expect(second.headers.location).toBe(ADDED_URL)

      const shown = await get(
        ADDED_URL,
        mergeCookies(mergeCookies({ ...cookies }, first), second)
      )

      expect(text(load(shown.result), '#client-secret-value')).toBe(SECRET)
    })

    test('says it was shown already for a replay after the secret was taken', async () => {
      let calls = 0

      backend({
        [`POST ${ADD_PATH}`]: () =>
          ++calls === 1 ? reply(201, ADDED) : reply(200, REPLAY)
      })

      const key = await shownKey()
      const first = await post(ADD_URL, { key })
      const jar = mergeCookies({ ...cookies }, first)

      await get(ADDED_URL, jar)

      const second = await post(ADD_URL, { key }, jar)
      const next = await get(ADDED_URL, mergeCookies(jar, second))

      expect(second.headers.location).toBe(ADDED_URL)
      expect(next.statusCode).toBe(statusCodes.seeOther)
      expect(next.headers.location).toBe(INFRADEV_URL)
    })

    test('says the secret is a placeholder when the mock issuer made it', async () => {
      backend({
        'GET /v1/credentials/cred-9': {
          _id: 'cred-9',
          tier: 'team',
          teamId: 'team-1',
          environment: 'infradev',
          issuerKey: 'mock'
        }
      })

      const { jar } = await added()
      const $ = load((await get(ADDED_URL, jar)).result)

      expect(
        text($, '[data-testid="placeholder-credential-notice"]')
      ).toContain('This client secret is a placeholder.')
      expect(text($, '#client-secret-value')).toBe(SECRET)
    })

    test('says a secret with no expiry does not expire, and leaves out the date step', async () => {
      backend({
        [`POST ${ADD_PATH}`]: reply(201, {
          ...ADDED,
          credential: { ...ADDED.credential, expiresAt: null }
        })
      })

      const { jar } = await added()
      const $ = load((await get(ADDED_URL, jar)).result)

      expect(text($, '[data-testid="client-secret-added"]')).toContain(
        'Stops working Does not expire'
      )
      expect(text($, '[data-testid="client-secret-next-steps"]')).not.toContain(
        'Before then'
      )
    })

    test('keeps the secret to show, and says it could not read, when the credential cannot be read', async () => {
      backend({
        'GET /v1/credentials/cred-9': reply(502, {
          code: 'upstream-unavailable'
        })
      })

      const { jar } = await added()
      const failed = await get(ADDED_URL, jar)

      expect(failed.statusCode).toBe(statusCodes.serviceUnavailable)
      expect(failed.result).not.toContain(SECRET)
      expect(text(load(failed.result), 'main')).toContain(
        'We could not read Infradev just now.'
      )
      expect(
        load(failed.result)('main a[href="' + ADDED_URL + '"]')
      ).toHaveLength(1)

      backend()

      const shown = await get(ADDED_URL, jar)

      expect(text(load(shown.result), '#client-secret-value')).toBe(SECRET)
    })

    test('keeps the secret to show when the credential read fails in a way the page cannot explain', async () => {
      backend({
        'GET /v1/credentials/cred-9': reply(400, { code: 'validation-error' })
      })

      const { jar } = await added()
      const failed = await get(ADDED_URL, jar)

      expect(failed.statusCode).toBe(statusCodes.internalServerError)

      backend()

      const shown = await get(ADDED_URL, jar)

      expect(text(load(shown.result), '#client-secret-value')).toBe(SECRET)
    })

    test('is 403 for a person who is no longer an admin, and leaves the secret for an admin to see', async () => {
      backend()

      const { jar } = await added()

      backend({ role: 'user' })

      const refused = await get(ADDED_URL, jar)

      expect(refused.statusCode).toBe(statusCodes.forbidden)
      expect(refused.result).not.toContain(SECRET)

      backend()

      expect(
        text(load((await get(ADDED_URL, jar)).result), '#client-secret-value')
      ).toBe(SECRET)
    })

    test('is 404 for a team that is not the person’s, and for an environment that is not available', async () => {
      backend({ [`GET ${TEAM_PATH}`]: NOT_MEMBER })

      expect((await get(ADDED_URL)).statusCode).toBe(statusCodes.notFound)

      backend()

      expect(
        (await get(`/environments/${sampleTeam.slug}/qa/client-secrets/added`))
          .statusCode
      ).toBe(statusCodes.notFound)
    })

    test('is not shown for another environment, which leaves it for its own', async () => {
      config.set('teamEnvironments', ['infradev', 'qa'])
      backend()

      const { jar } = await added()
      const other = await get(`${OVERVIEW_URL}/qa/client-secrets/added`, jar)

      expect(other.statusCode).toBe(statusCodes.seeOther)
      expect(other.headers.location).toBe(`${OVERVIEW_URL}/qa`)
      expect(other.result).not.toContain(SECRET)
      expect(
        text(load((await get(ADDED_URL, jar)).result), '#client-secret-value')
      ).toBe(SECRET)
    })

    test('says the page is unavailable when the team cannot be read', async () => {
      backend({
        [`GET ${TEAM_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const response = await get(ADDED_URL)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
    })

    test('is a fault when the team cannot be read in a way the page cannot explain', async () => {
      backend({
        [`GET ${TEAM_PATH}`]: reply(400, { code: 'validation-error' })
      })

      expect((await get(ADDED_URL)).statusCode).toBe(
        statusCodes.internalServerError
      )
    })
  })
})

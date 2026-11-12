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

const TEAM = '/v1/admin/teams/team-1'
const TEAM_URL = '/admin/teams/team-1'
const ADD_URL = `${TEAM_URL}/members/add`
const OID = '0b8f6f4e-3c0f-4c46-9c58-2d3a8d2f1a11'
const sam = {
  oid: OID,
  displayName: 'Sam Carter',
  email: 'sam.carter@defra.gov.uk'
}

function answer(status, code) {
  return reply(status, { statusCode: status, code, message: 'Refused' })
}

const FORBIDDEN = answer(403, 'platform-admin-required')

function member(id, name, role = 'user', userId = `user-${id}`) {
  return {
    _id: `member-${id}`,
    userId,
    displayName: name,
    email: `${name.toLowerCase().replace(' ', '.')}@defra.gov.uk`,
    role,
    status: 'active'
  }
}

function team(status = 'active') {
  return {
    team: {
      id: 'team-1',
      name: 'Flood Risk Team',
      slug: 'flood-risk-team',
      serviceCode: 'FRM',
      status,
      environments: []
    },
    members: [
      member(1, 'Test User', 'admin', 'user-1'),
      member(2, 'Priya Raman', 'admin'),
      member(3, 'Tom Ellis')
    ]
  }
}

describe('#admin team members', () => {
  let server
  let cookies
  let logged

  beforeAll(async () => {
    server = await createServer()
    // Everything the app could write to its log for a request, to prove who
    // was searched for or added is never in it.
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

  function writes() {
    return fetchMock
      .requests()
      .filter(
        (request) =>
          new URL(request.url).pathname.startsWith('/v1/admin') &&
          request.method !== 'GET' &&
          !request.url.includes('/people/search')
      )
  }

  describe('the add page', () => {
    test('redirects a signed out person to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: ADD_URL
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toContain('/sign-in')
    })

    test('shows the form for the team, with Back to the team’s admin page', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: team() })

      const { statusCode, result } = await get(ADD_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('title').text()).toContain('Add a member')
      expect($('h1').text()).toBe('Add a member')
      expect($('[data-testid="app-heading-caption"]').text()).toBe(
        'Flood Risk Team'
      )
      expect($('.govuk-back-link').attr('href')).toBe(TEAM_URL)
      expect($('main form').attr('data-people-search-url')).toBe(
        `${ADD_URL}/people`
      )
      expect($('[data-testid="search-people"]')).toHaveLength(1)
      expect($('input[name="idempotencyKey"]').attr('value')).toMatch(
        /^[0-9a-f-]{36}$/
      )
      expect($('input[name="role"]:checked').attr('value')).toBe('user')
    })

    test.each([['disabled'], ['pending-removal']])(
      'still shows it for a %s team',
      async (status) => {
        mockApi(fetchMock, { [`GET ${TEAM}`]: team(status) })

        expect((await get(ADD_URL)).statusCode).toBe(statusCodes.ok)
      }
    )

    test('shows the 403 page when the backend refuses the person', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: FORBIDDEN })

      const { statusCode, result } = await get(ADD_URL)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(result).toContain('Only a Platform Admin can use this page')
    })

    test('shows the team not found page for a team the backend does not have', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: answer(404, 'team-not-found') })

      const { statusCode, result } = await get(ADD_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Team not found')
    })
  })

  describe('searching without script', () => {
    test('shows the matches in a list, found through the admin route', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`POST ${TEAM}/people/search`]: { items: [sam] }
      })

      const { statusCode, result } = await post(ADD_URL, {
        action: 'search',
        search: ' sam '
      })
      const $ = load(result)
      const [search] = fetchMock
        .requests()
        .filter((request) => request.url.includes('/people/search'))

      expect(statusCode).toBe(statusCodes.ok)
      expect(await search.json()).toEqual({ search: 'sam' })
      expect($('select#oid option').last().text()).toBe(
        'Sam Carter - sam.carter@defra.gov.uk'
      )
      expect($('#oid-hint').text().trim()).toBe('1 person found')
    })

    test('says no one was found', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`POST ${TEAM}/people/search`]: { items: [] }
      })

      const { result } = await post(ADD_URL, {
        action: 'search',
        search: 'nobody'
      })

      expect(load(result)('[data-testid="no-people"]').text()).toContain(
        'No one found for ‘nobody’'
      )
    })

    test('shows an error on the search field for text that is too short, and asks nothing', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: team() })

      const { statusCode, result } = await post(ADD_URL, {
        action: 'search',
        search: 'a'
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('title').text()).toContain('Error: Add a member')
      expect($('.govuk-error-summary a').attr('href')).toBe('#search')
      expect(
        fetchMock.requests().filter((r) => r.url.includes('/people/search'))
      ).toHaveLength(0)
    })

    test('shows the 403 page when the backend refuses the search', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`POST ${TEAM}/people/search`]: FORBIDDEN
      })

      const { statusCode } = await post(ADD_URL, {
        action: 'search',
        search: 'sam'
      })

      expect(statusCode).toBe(statusCodes.forbidden)
    })
  })

  describe('adding a person', () => {
    const add = (extra = {}) =>
      post(ADD_URL, { action: 'add', oid: OID, role: 'admin', ...extra })

    test('adds them through the admin route with the role and a key, and shows the team with a banner', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`POST ${TEAM}/members`]: reply(201, {
          member: { _id: 'member-4', displayName: 'Sam Carter' }
        })
      })

      const response = await add()
      const [sent] = writes()

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(TEAM_URL)
      expect(sent.method).toBe('POST')
      expect(new URL(sent.url).pathname).toBe(`${TEAM}/members`)
      expect(await sent.json()).toEqual({ oid: OID, role: 'admin' })
      expect(sent.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)

      const page = load((await follow(response)).result)

      expect(page('[data-testid="team-notification"] h3').text().trim()).toBe(
        'Sam Carter has been added'
      )

      const again = load((await follow(response)).result)

      expect(again('[data-testid="team-notification"]')).toHaveLength(0)
    })

    test.each([
      ['member-exists', 409, 'This person is already a member of this team'],
      [
        'person-not-eligible',
        422,
        'This person cannot be added to a team. Search again and choose someone else'
      ],
      [
        'self-add-refused',
        403,
        'You cannot add yourself to a team. Ask another Platform Admin to add you'
      ]
    ])(
      'shows %s as an error on the page, with the form again',
      async (code, status, text) => {
        mockApi(fetchMock, {
          [`GET ${TEAM}`]: team(),
          [`POST ${TEAM}/members`]: answer(status, code),
          [`POST ${TEAM}/people/search`]: { items: [] }
        })

        const { statusCode, result } = await add()
        const $ = load(result)

        expect(statusCode).toBe(status)
        expect($('title').text()).toContain('Error: Add a member')
        expect($('.govuk-error-summary').text()).toContain(text)
        expect($('input[name="role"]:checked').attr('value')).toBe('admin')
        expect($('main form')).toHaveLength(1)
      }
    )

    test('shows the 403 page when the backend refuses the add', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`POST ${TEAM}/members`]: FORBIDDEN
      })

      const { statusCode, result } = await add()

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(result).toContain('Only a Platform Admin can use this page')
    })

    test('says the team is not found when it has gone', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`POST ${TEAM}/members`]: answer(404, 'team-not-found')
      })

      const { statusCode } = await add()

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('asks for a person when none is chosen, and adds no one', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: team() })

      const { statusCode, result } = await post(ADD_URL, {
        action: 'add',
        oid: '',
        role: 'user'
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(load(result)('.govuk-error-summary').text()).toContain(
        'Select a person'
      )
      expect(writes()).toHaveLength(0)
    })

    test('writes nothing to the log that says who was searched for or added', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`POST ${TEAM}/members`]: answer(409, 'member-exists'),
        [`POST ${TEAM}/people/search`]: { items: [sam] }
      })

      await add({
        search: 'sam.carter@defra.gov.uk',
        query: 'sam.carter@defra.gov.uk'
      })
      await post(ADD_URL, {
        action: 'search',
        search: 'sam.carter@defra.gov.uk'
      })

      expect(JSON.stringify(logged)).not.toContain('sam.carter')
      expect(JSON.stringify(logged)).not.toContain(OID)
    })
  })

  describe('the people search behind the combobox', () => {
    function search(payload, jar = cookies) {
      return server.inject({
        method: 'POST',
        url: `${ADD_URL}/people`,
        headers: {
          cookie: cookieHeader(jar),
          'content-type': 'application/json',
          'x-csrf-token': jar.crumb
        },
        payload: JSON.stringify(payload)
      })
    }

    test('answers with the people the backend found for the team, and never caches them', async () => {
      mockApi(fetchMock, {
        [`POST ${TEAM}/people/search`]: {
          items: [{ ...sam, userId: 'internal' }]
        }
      })

      const response = await search({ search: 'sam' })

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(JSON.parse(response.payload)).toEqual({ items: [sam] })
    })

    test.each([
      [403, 'Only a Platform Admin can search for people'],
      [404, 'This team does not exist'],
      [500, 'We could not search the directory. Try again in a few minutes']
    ])(
      'answers %s with a message the box can show',
      async (status, message) => {
        mockApi(fetchMock, {
          [`POST ${TEAM}/people/search`]: answer(status, 'refused')
        })

        const response = await search({ search: 'sam' })

        expect(response.statusCode).toBe(status === 500 ? 503 : status)
        expect(JSON.parse(response.payload)).toEqual({ message })
      }
    )

    test('refuses text that is too short, and asks nothing', async () => {
      const response = await search({ search: 'a' })

      expect(response.statusCode).toBe(statusCodes.badRequest)
      expect(
        fetchMock.requests().filter((r) => r.url.includes('/people'))
      ).toHaveLength(0)
    })
  })

  describe('the remove page', () => {
    const REMOVE = `${TEAM_URL}/members/member-2/remove`

    test('redirects a signed out person to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: REMOVE
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toContain('/sign-in')
    })

    test('warns that the team’s credentials are not changed, and asks the admin to confirm', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: team() })

      const { statusCode, result } = await get(REMOVE)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text()).toBe('Remove Priya Raman from Flood Risk Team?')
      expect($('#remove-member').text()).toContain(
        'Ask a team admin to rotate or revoke them if this person had a copy.'
      )
      expect($('#remove-member').text()).not.toContain('client secret')
      expect($('[data-testid="remove-member-confirm"]').text().trim()).toBe(
        'Remove Priya Raman'
      )
      expect($('[data-testid="remove-member-cancel"]').attr('href')).toBe(
        TEAM_URL
      )
      expect($('.govuk-back-link').attr('href')).toBe(TEAM_URL)
    })

    test.each([['disabled'], ['pending-removal']])(
      'still shows it for a %s team',
      async (status) => {
        mockApi(fetchMock, { [`GET ${TEAM}`]: team(status) })

        expect((await get(REMOVE)).statusCode).toBe(statusCodes.ok)
      }
    )

    test.each([['member-99'], ['member-3x']])(
      'says the member is not found for %s',
      async (id) => {
        mockApi(fetchMock, { [`GET ${TEAM}`]: team() })

        const { statusCode, result } = await get(
          `${TEAM_URL}/members/${id}/remove`
        )
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.notFound)
        expect($('h1').text()).toBe('Member not found')
        expect($('main .govuk-button').attr('href')).toBe(TEAM_URL)
      }
    )

    test('does not offer a member who has already been removed', async () => {
      const gone = team()

      gone.members[2].status = 'removed'
      mockApi(fetchMock, { [`GET ${TEAM}`]: gone })

      const { statusCode } = await get(`${TEAM_URL}/members/member-3/remove`)

      expect(statusCode).toBe(statusCodes.notFound)
    })

    test('shows the 403 page when the backend refuses the person', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: FORBIDDEN })

      expect((await get(REMOVE)).statusCode).toBe(statusCodes.forbidden)
    })

    test('shows the team not found page for a team the backend does not have', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: answer(404, 'team-not-found') })

      const { statusCode, result } = await get(REMOVE)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Team not found')
    })
  })

  describe('removing a person', () => {
    const REMOVE = `${TEAM_URL}/members/member-2/remove`

    test('removes them through the admin route and shows the team with a banner', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`DELETE ${TEAM}/members/member-2`]: reply(204)
      })

      const response = await post(REMOVE)
      const [sent] = writes()

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(TEAM_URL)
      expect(sent.method).toBe('DELETE')
      expect(new URL(sent.url).pathname).toBe(`${TEAM}/members/member-2`)

      const page = load((await follow(response)).result)

      expect(page('[data-testid="team-notification"]').text()).toContain(
        'Priya Raman has been removed from Flood Risk Team.'
      )
    })

    test('says so when the admin removes themselves as a member, and stays in the Admin area', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`DELETE ${TEAM}/members/member-1`]: reply(204)
      })

      const response = await post(`${TEAM_URL}/members/member-1/remove`)
      const page = load((await follow(response)).result)

      expect(response.headers.location).toBe(TEAM_URL)
      expect(page('[data-testid="team-notification"]').text()).toContain(
        'You have been removed from Flood Risk Team.'
      )
    })

    test('keeps the last admin, and says what to do', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`DELETE ${TEAM}/members/member-2`]: answer(409, 'last-admin')
      })

      const { statusCode, result } = await post(REMOVE)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.conflict)
      expect($('title').text()).toContain('Error: Remove Priya Raman')
      expect($('.govuk-error-summary a').attr('href')).toBe('#remove-member')
      expect($('.govuk-error-summary').text()).toContain(
        'A team must keep at least one admin. Add another admin before you remove Priya Raman from this team.'
      )
    })

    test('says the member is not found when the backend has no such member', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`DELETE ${TEAM}/members/member-2`]: answer(404, 'member-not-found')
      })

      const { statusCode, result } = await post(REMOVE)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Member not found')
    })

    test('shows the 403 page when the backend refuses the removal', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM}`]: team(),
        [`DELETE ${TEAM}/members/member-2`]: FORBIDDEN
      })

      expect((await post(REMOVE)).statusCode).toBe(statusCodes.forbidden)
    })

    test('removes no one when the page cannot find the member', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: team() })

      const { statusCode } = await post(`${TEAM_URL}/members/member-99/remove`)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(writes()).toHaveLength(0)
    })

    test('says it could not load the page when the backend fails', async () => {
      mockApi(fetchMock, { [`GET ${TEAM}`]: answer(500, 'internal') })

      const { statusCode } = await post(REMOVE)

      expect(statusCode).toBe(statusCodes.badGateway)
    })
  })
})

import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  signInViaOidc,
  mergeCookies,
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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const TEAM_PATH = `/v1/teams/${sampleTeam.slug}`
const TEAM_URL = `/teams/${sampleTeam.slug}`
const MEMBERS_URL = `${TEAM_URL}/members`
const NOT_FOUND = reply(404, { code: 'not-found', message: 'Not Found' })
const SEARCH_PATH = `${TEAM_PATH}/people/search`
const OID = '0b8f6f4e-3c0f-4c46-9c58-2d3a8d2f1a11'
const OTHER_OID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const sam = {
  oid: OID,
  displayName: 'Sam Carter',
  email: 'sam.carter@defra.gov.uk'
}
const alex = {
  oid: OTHER_OID,
  displayName: 'Alex Doe',
  email: 'alex.doe@defra.gov.uk'
}

const you = (role) => ({
  _id: 'member-1',
  userId: 'user-1',
  displayName: 'Test User',
  email: 'test.user@defra.gov.uk',
  role,
  status: 'active'
})
const priya = (role = 'admin') => ({
  _id: 'member-2',
  userId: 'user-2',
  displayName: 'Priya Raman',
  email: 'priya.raman@defra.gov.uk',
  role,
  status: 'active'
})
const tom = {
  _id: 'member-3',
  userId: 'user-3',
  displayName: 'Tom Ellis',
  email: 'tom.ellis@defra.gov.uk',
  role: 'user',
  status: 'active'
}

function roleUrl(memberId) {
  return `${MEMBERS_URL}/${memberId}/role`
}

const lastAdmin = reply(409, {
  statusCode: 409,
  error: 'Conflict',
  message: 'A team must keep at least one admin',
  code: 'last-admin'
})

describe('#members', () => {
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

  // The signed-in person is a member or an admin of the team, with Priya an
  // admin and Tom a member; or (no role) is not in the team at all, which the
  // backend answers as not found.
  function backend(role, extra = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: role
        ? {
            team: sampleTeam,
            members: [you(role), priya(), tom],
            environments: []
          }
        : NOT_FOUND,
      'GET /v1/teams': { items: [] },
      ...extra
    })
  }

  function get(url, jar = cookies) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(jar) }
    })
  }

  function post(url, payload = {}) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, ...payload }
    })
  }

  // Follows a redirect with the session the response set, as the browser does.
  function follow(response) {
    return get(
      response.headers.location,
      mergeCookies({ ...cookies }, response)
    )
  }

  // A search is a POST that changes nothing, so it is not a write.
  function searches() {
    return fetchMock.mock.calls.filter(([url]) =>
      url.includes('/people/search')
    )
  }

  function writes() {
    return fetchMock.mock.calls.filter(
      ([url, options]) =>
        url.includes('/v1/teams') &&
        !url.includes('/people/search') &&
        options?.method &&
        options.method !== 'GET'
    )
  }

  describe('the Members tab', () => {
    test('GET /teams/{slug}/members redirects to /sign-in when signed out', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: MEMBERS_URL
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toContain('/sign-in')
    })

    test('for a person with only their own keys: is not found, and does not say whether the team exists', async () => {
      backend(null)

      const { statusCode, result } = await get(MEMBERS_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Team not found')
      expect(result).not.toContain('Flood Risk Team')
      expect(result).not.toContain('priya.raman')
    })

    test('for a member: lists everyone with their role, hides colleagues’ addresses, and offers no change', async () => {
      backend('user')

      const { statusCode, result } = await get(MEMBERS_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="app-heading-caption"]').text()).toBe('Team')
      expect($('h1').text()).toBe('Flood Risk Team')
      expect(
        $('[data-testid="sub-navigation"] [aria-current="page"]').text()
      ).toBe('Members')

      const rows = $('[data-testid="member-row"]')
        .map((_, row) =>
          $(row)
            .find('td')
            .map((__, cell) => $(cell).text().trim())
            .get()
        )
        .get()

      expect(rows).toEqual([
        'Test User (you)',
        'test.user@defra.gov.uk',
        'Member',
        'Priya Raman',
        'p**********@defra.gov.uk',
        'Admin',
        'Tom Ellis',
        't********@defra.gov.uk',
        'Member'
      ])
      expect(result).not.toContain('data-testid="add-member"')
      expect(result).not.toContain('data-testid="member-change"')
      expect(result).toContain(
        'Members can use the team’s models and add new ones. Admins can also see and rotate client secrets, add people, change roles and remove models.'
      )
    })

    test('for an admin: shows every address, a Change link for each person, and the button to add a member', async () => {
      backend('admin')

      const { result } = await get(MEMBERS_URL)
      const $ = load(result)

      expect($('[data-testid="add-member"]').attr('href')).toBe(
        `${MEMBERS_URL}/add`
      )
      expect($('[data-testid="add-member"]').text().trim()).toBe('Add a member')
      expect(result).toContain('priya.raman@defra.gov.uk')
      expect(result).toContain('tom.ellis@defra.gov.uk')
      expect(
        $('[data-testid="member-row"]')
          .map((_, row) => $(row).find('td').first().text().trim())
          .get()
      ).toEqual(['Test User (you)', 'Priya Raman', 'Tom Ellis'])
      expect(result).not.toContain('Not signed in yet')
      expect(result).not.toContain('member-not-signed-in')
      expect(
        $('[data-testid="member-change"]')
          .map((_, link) => $(link).attr('href'))
          .get()
      ).toEqual([
        `${MEMBERS_URL}/me/role`,
        `${MEMBERS_URL}/member-2/role`,
        `${MEMBERS_URL}/member-3/role`
      ])
      expect($('[data-testid="member-change"]').first().text()).toContain(
        'Change role of Test User'
      )
      // The table is full width, and the Change column sits at the right.
      expect(
        $('.govuk-grid-column-full [data-testid="members-table"]')
      ).toHaveLength(1)
      expect(
        $('[data-testid="member-change"]')
          .first()
          .parent()
          .hasClass('govuk-table__cell--numeric')
      ).toBe(true)
    })

    test('masks a colleague’s name when it is their address, for a member but not for an admin', async () => {
      const members = [
        you('user'),
        { ...priya(), displayName: 'priya.raman@defra.gov.uk' }
      ]
      const team = { team: sampleTeam, members, environments: [] }

      mockApi(fetchMock, { [`GET ${TEAM_PATH}`]: team })

      const asMember = await get(MEMBERS_URL)

      expect(asMember.result).not.toContain('priya.raman@defra.gov.uk')
      expect(asMember.result).toContain('p**********@defra.gov.uk')

      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: {
          ...team,
          members: [you('admin'), members[1]]
        }
      })

      const asAdmin = await get(MEMBERS_URL)

      expect(asAdmin.result).toContain('priya.raman@defra.gov.uk')
    })
    test('names each person by their name for a screen reader', async () => {
      backend('admin')

      const { result } = await get(MEMBERS_URL)

      expect(result).toContain(
        'Change<span class="govuk-visually-hidden"> role of Tom Ellis'
      )
    })

    test('shows the team’s change banner once, then not again', async () => {
      backend('admin', { [`DELETE ${TEAM_PATH}/members/member-3`]: reply(204) })

      const removed = await post(`${MEMBERS_URL}/member-3/remove`)
      const jar = mergeCookies({ ...cookies }, removed)
      const page = await get(MEMBERS_URL, jar)
      const again = await get(MEMBERS_URL, mergeCookies(jar, page))

      expect(page.result).toContain('data-testid="team-notification"')
      expect(again.result).not.toContain('data-testid="team-notification"')
    })

    test('does not break when the backend fails', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: reply(500, { code: 'internal' })
      })

      const { statusCode } = await get(MEMBERS_URL)

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  describe('signed out, with a valid CSRF token', () => {
    test.each([
      [
        'adding a member',
        `${MEMBERS_URL}/add`,
        { action: 'search', search: 'x' }
      ],
      ['changing a role', `${MEMBERS_URL}/member-2/role`, { role: 'owner' }]
    ])(
      'sends an invalid submission for %s to sign in, without reading the team',
      async (_name, url, payload) => {
        backend('admin')

        const { statusCode, headers } = await server.inject({
          method: 'POST',
          url,
          headers: { cookie: cookieHeader({ crumb: cookies.crumb }) },
          payload: { crumb: cookies.crumb, ...payload }
        })

        expect(statusCode).toBe(302)
        expect(headers.location).toBe(
          `/sign-in?returnTo=${encodeURIComponent(url)}`
        )
        expect(
          fetchMock.mock.calls.filter(([target]) =>
            target.includes('/v1/teams')
          )
        ).toHaveLength(0)
      }
    )
  })
  describe('adding a member', () => {
    test('for a person with only their own keys: is not found', async () => {
      backend(null)

      const page = await get(`${MEMBERS_URL}/add`)
      const submitted = await post(`${MEMBERS_URL}/add`, {
        action: 'add',
        oid: OID
      })

      expect(page.statusCode).toBe(statusCodes.notFound)
      expect(submitted.statusCode).toBe(statusCodes.notFound)
      expect(writes()).toHaveLength(0)
    })

    test('for a member: says only an admin can, and searches for and adds no one', async () => {
      backend('user')

      const page = await get(`${MEMBERS_URL}/add`)
      const searched = await post(`${MEMBERS_URL}/add`, {
        action: 'search',
        search: 'sam'
      })
      const submitted = await post(`${MEMBERS_URL}/add`, {
        action: 'add',
        oid: OID
      })
      const invalid = await post(`${MEMBERS_URL}/add`, { action: 'add' })

      for (const response of [page, searched, submitted, invalid]) {
        expect(response.statusCode).toBe(statusCodes.forbidden)
        expect(response.result).toContain(
          'Only an admin of Flood Risk Team can add people.'
        )
        expect(response.result).toContain(`href="${MEMBERS_URL}"`)
      }

      expect(writes()).toHaveLength(0)
      expect(searches()).toHaveLength(0)
    })

    test('for an admin: asks for a name or email, then a role (Member by default), and says they can use the team straight away', async () => {
      backend('admin')

      const { statusCode, result } = await get(`${MEMBERS_URL}/add`)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('.govuk-back-link').attr('href')).toBe(MEMBERS_URL)
      expect($('[data-testid="app-heading-caption"]').text()).toBe(
        'Flood Risk Team'
      )
      expect($('h1').text()).toBe('Add a member')
      expect($('label[for="search"]').text().trim()).toBe(
        'Name or email address'
      )
      expect($('#search-hint').text().trim()).toBe(
        'Enter at least 2 characters of their name or Defra email address'
      )
      expect($('#search').attr('name')).toBe('search')
      expect($('[data-people-search-url]').attr('data-people-search-url')).toBe(
        `${MEMBERS_URL}/add/people`
      )
      expect($('input[name="role"]:checked').attr('value')).toBe('user')
      expect($('.govuk-inset-text').text().trim()).toBe(
        'They can use the team straight away'
      )
      expect($('[data-testid="search-people"]').text().trim()).toBe('Search')
      expect($('[data-testid="search-people"]').attr('value')).toBe('search')
      expect($('[data-testid="add-member-submit"]').text().trim()).toBe('Add')
      expect($('[data-testid="add-member-submit"]').attr('value')).toBe('add')
      expect($('select[name="oid"]')).toHaveLength(0)
      expect($('input[name="idempotencyKey"]')).toHaveLength(0)
      expect(searches()).toHaveLength(0)
    })

    test('puts Search before Add, so that Enter in the text field searches instead of adding', async () => {
      backend('admin')

      const { result } = await get(`${MEMBERS_URL}/add`)
      const $ = load(result)
      const actions = $('form button[name="action"]')
        .map((_, button) => $(button).attr('value'))
        .get()

      expect(actions).toEqual(['search', 'add'])
    })

    test('refuses a submission with no CSRF token, and adds and searches for no one', async () => {
      backend('admin')

      const { statusCode } = await server.inject({
        method: 'POST',
        url: `${MEMBERS_URL}/add`,
        headers: { cookie: cookieHeader(cookies) },
        payload: { action: 'add', oid: OID }
      })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(writes()).toHaveLength(0)
      expect(searches()).toHaveLength(0)
    })

    describe('searching without JavaScript', () => {
      test('lists the matches in a select list, keeps what was typed and the role, and adds nobody', async () => {
        backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [sam, alex] } })

        const { statusCode, result } = await post(`${MEMBERS_URL}/add`, {
          action: 'search',
          search: ' sa ',
          role: 'admin'
        })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.ok)
        expect(JSON.parse(searches()[0][1].body)).toEqual({ search: 'sa' })
        expect(searches()[0][1].headers['x-user-id']).toBe('user-1')
        expect($('label[for="oid"]').text().trim()).toBe('Person')
        expect($('#oid-hint').text().trim()).toBe('2 people found')
        expect(
          $('select[name="oid"] option')
            .map((_, option) => [[$(option).attr('value'), $(option).text()]])
            .get()
        ).toEqual([
          ['', 'Select a person'],
          [OID, 'Sam Carter - sam.carter@defra.gov.uk'],
          [OTHER_OID, 'Alex Doe - alex.doe@defra.gov.uk']
        ])
        expect($('#search').attr('value')).toBe('sa')
        expect($('input[name="role"]:checked').attr('value')).toBe('admin')
        expect($('title').text()).not.toContain('Error')
        expect(writes()).toHaveLength(0)
      })

      test('says "1 person found" for one match', async () => {
        backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [sam] } })

        const { result } = await post(`${MEMBERS_URL}/add`, {
          action: 'search',
          search: 'sam'
        })

        expect(load(result)('#oid-hint').text().trim()).toBe('1 person found')
      })

      test('shows an empty state that suggests their full email address when nobody matches', async () => {
        backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [] } })

        const { statusCode, result } = await post(`${MEMBERS_URL}/add`, {
          action: 'search',
          search: 'zzz'
        })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.ok)
        expect($('[data-testid="no-people"]').text()).toContain(
          'No one found for ‘zzz’'
        )
        expect($('[data-testid="no-people"]').text()).toContain(
          'Try their full email address.'
        )
        expect($('select[name="oid"]')).toHaveLength(0)
        expect($('#search').attr('value')).toBe('zzz')
      })

      test.each([
        ['', 'Enter a name or email address to search for'],
        ['a', 'Enter at least 2 characters of their name or email address'],
        ['  a  ', 'Enter at least 2 characters of their name or email address'],
        [
          'x'.repeat(101),
          'Name or email address must be 100 characters or fewer'
        ]
      ])(
        'shows an error for the search text "%s", keeps it and does not search',
        async (search, message) => {
          backend('admin')

          const { statusCode, result } = await post(`${MEMBERS_URL}/add`, {
            action: 'search',
            search,
            role: 'admin'
          })
          const $ = load(result)

          expect(statusCode).toBe(statusCodes.badRequest)
          expect($('.govuk-error-summary__list a').attr('href')).toBe('#search')
          expect($('.govuk-error-summary__list').text()).toContain(message)
          expect($('#search-error').text()).toContain(message)
          expect($('#search').attr('value')).toBe(search)
          expect($('input[name="role"]:checked').attr('value')).toBe('admin')
          expect($('title').text()).toContain('Error: Add a member')
          expect(searches()).toHaveLength(0)
          expect(writes()).toHaveLength(0)
        }
      )

      test('says the directory is not available, keeps the text and adds nobody when the search fails', async () => {
        backend('admin', {
          [`POST ${SEARCH_PATH}`]: reply(503, {
            code: 'directory-unavailable'
          })
        })

        const { statusCode, result } = await post(`${MEMBERS_URL}/add`, {
          action: 'search',
          search: 'sam'
        })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.serviceUnavailable)
        expect($('#search-error').text()).toContain(
          'We could not reach the directory. Try again in a few minutes'
        )
        expect($('.govuk-error-summary__list a').attr('href')).toBe('#search')
        expect($('#search').attr('value')).toBe('sam')
        expect($('title').text()).toContain('Error: Add a member')
        expect(writes()).toHaveLength(0)
      })

      test('shows the page for a refusal that arrives after the team was read, and fails on anything else', async () => {
        backend('admin', {
          [`POST ${SEARCH_PATH}`]: reply(403, { code: 'admin-required' })
        })

        const refused = await post(`${MEMBERS_URL}/add`, {
          action: 'search',
          search: 'sam'
        })

        expect(refused.statusCode).toBe(statusCodes.forbidden)

        backend('admin', {
          [`POST ${SEARCH_PATH}`]: reply(500, { code: 'internal' })
        })

        const failed = await post(`${MEMBERS_URL}/add`, {
          action: 'search',
          search: 'sam'
        })

        expect(failed.statusCode).toBe(statusCodes.internalServerError)
      })

      test('never adds anyone when the action is missing, whatever else is sent', async () => {
        backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [sam] } })

        const { statusCode } = await post(`${MEMBERS_URL}/add`, {
          search: 'sam',
          oid: OID
        })

        expect(statusCode).toBe(statusCodes.ok)
        expect(writes()).toHaveLength(0)
      })
    })

    describe('adding the person chosen', () => {
      function add(payload = {}) {
        return post(`${MEMBERS_URL}/add`, {
          action: 'add',
          search: 'sam',
          oid: OID,
          role: 'user',
          ...payload
        })
      }

      test('adds the person by oid with the role, once, and goes back to the Members tab with a banner', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(201, {
            member: { _id: 'member-4', displayName: 'Sam Carter' }
          })
        })

        const response = await add({ role: 'admin' })

        expect(response.statusCode).toBe(statusCodes.seeOther)
        expect(response.headers.location).toBe(MEMBERS_URL)

        const [[url, options]] = writes()

        expect(writes()).toHaveLength(1)
        expect(url).toContain(`${TEAM_PATH}/members`)
        expect(options.method).toBe('POST')
        expect(JSON.parse(options.body)).toEqual({ oid: OID, role: 'admin' })
        expect(options.headers['x-user-id']).toBe('user-1')
        expect(options.headers['idempotency-key']).toMatch(UUID)

        const { result } = await follow(response)

        expect(result).toContain('Sam Carter has been added')
        expect(result).toContain('They can use the team straight away.')
      })

      test('keeps the idempotency key for a retry of the same person and role, so the backend adds once', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(503, {
            code: 'directory-unavailable'
          })
        })

        await add()
        await add()

        const keys = writes().map(
          ([, options]) => options.headers['idempotency-key']
        )

        expect(keys[0]).toMatch(UUID)
        expect(keys[1]).toBe(keys[0])
      })

      test('uses a new key for a different person or a different role, so the backend cannot replay the first choice', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(503, {
            code: 'directory-unavailable'
          })
        })

        await add()
        await add({ oid: OTHER_OID })
        await add({ oid: OTHER_OID, role: 'admin' })
        await add({ oid: OTHER_OID, role: 'admin' })

        const keys = writes().map(
          ([, options]) => options.headers['idempotency-key']
        )

        expect(new Set(keys.slice(0, 3)).size).toBe(3)
        expect(keys[3]).toBe(keys[2])
      })

      test('uses a new key once the person has been added, so adding them again after they are removed is a new add', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(201, {
            member: { displayName: 'Sam Carter' }
          })
        })

        await add()
        await add()

        const keys = writes().map(
          ([, options]) => options.headers['idempotency-key']
        )

        expect(keys[0]).toMatch(UUID)
        expect(keys[1]).toMatch(UUID)
        expect(keys[1]).not.toBe(keys[0])
      })

      test('keeps a person’s key to their own session', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(503, {
            code: 'directory-unavailable'
          })
        })

        await add()

        cookies = await signInViaOidc(server, fetchMock)
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(503, {
            code: 'directory-unavailable'
          })
        })
        await add()

        const keys = writes().map(
          ([, options]) => options.headers['idempotency-key']
        )

        expect(keys[1]).not.toBe(keys[0])
      })

      test('refuses an add with no role, shows the GOV.UK error with no role chosen, and adds no one', async () => {
        backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [sam] } })

        const { statusCode, result } = await add({ role: undefined })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('.govuk-error-summary__list a').attr('href')).toBe('#role')
        expect($('.govuk-error-summary__list').text()).toContain(
          'Select a role'
        )
        expect($('#role-error').text()).toContain('Select a role')
        expect($('input[name="role"]:checked')).toHaveLength(0)
        expect($('select[name="oid"]').val()).toBe(OID)
        expect($('title').text()).toContain('Error: Add a member')
        expect(writes()).toHaveLength(0)
      })

      test('names the banner after the person when the backend gives no name', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(201, { member: {} })
        })

        const { result } = await follow(await add())

        expect(result).toContain('This person has been added')
      })

      test.each([
        ['no person', { oid: '' }],
        ['a person who is not an id', { oid: 'sam.carter' }],
        ['no oid at all', { oid: undefined }]
      ])(
        'asks for a person when there is %s, and adds no one',
        async (_name, payload) => {
          backend('admin')

          const { statusCode, result } = await add({
            ...payload,
            search: 'x',
            role: 'admin'
          })
          const $ = load(result)

          expect(statusCode).toBe(statusCodes.badRequest)
          expect($('.govuk-error-summary__list a').attr('href')).toBe('#search')
          expect($('.govuk-error-summary__list').text()).toContain(
            'Select a person'
          )
          expect($('#search-error').text()).toContain('Select a person')
          expect($('#search').attr('value')).toBe('x')
          expect($('input[name="role"]:checked').attr('value')).toBe('admin')
          expect($('title').text()).toContain('Error: Add a member')
          expect(writes()).toHaveLength(0)
        }
      )

      test('shows the matches again, with the error on the select list, when Add was sent without a person', async () => {
        backend('admin', {
          [`POST ${SEARCH_PATH}`]: { items: [sam, alex] }
        })

        const { statusCode, result } = await add({ oid: '' })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('.govuk-error-summary__list a').attr('href')).toBe('#oid')
        expect($('#oid-error').text()).toContain('Select a person')
        expect($('select[name="oid"] option')).toHaveLength(3)
        expect($('select[name="oid"]').val()).toBe('')
        expect($('#search-error')).toHaveLength(0)
        expect(writes()).toHaveLength(0)
      })

      test('shows an error for a role that is not one, and keeps the person chosen', async () => {
        backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [sam, alex] } })

        const { statusCode, result } = await add({ role: 'owner' })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('#role-error').text()).toContain('Select a role')
        expect($('select[name="oid"]').val()).toBe(OID)
        expect(writes()).toHaveLength(0)
      })

      test('does not search again for a search text that is not valid, or when the add was not tried', async () => {
        backend('admin')

        await add({ oid: '', search: 'x' })
        await post(`${MEMBERS_URL}/add`, { action: 'search', search: 'x' })

        expect(searches()).toHaveLength(0)
      })

      test('still shows the error when the matches cannot be found again', async () => {
        backend('admin', {
          [`POST ${SEARCH_PATH}`]: reply(503, { code: 'directory-unavailable' })
        })

        const { statusCode, result } = await add({ oid: '' })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('#search-error').text()).toContain('Select a person')
        expect($('select[name="oid"]')).toHaveLength(0)
      })

      test('fails on a fault of its own when the matches are looked for again', async () => {
        fetchMock.mockResponse(async (request) =>
          request.url.includes('/people/search')
            ? 'not json'
            : JSON.stringify({
                team: sampleTeam,
                members: [you('admin'), priya()],
                environments: []
              })
        )

        const { statusCode } = await add({ oid: '' })

        expect(statusCode).toBe(statusCodes.internalServerError)
      })

      test.each([
        [
          409,
          'member-exists',
          'This person is already a member of this team',
          OTHER_OID
        ],
        [
          422,
          'person-not-eligible',
          'This person cannot be added to a team. Search again and choose someone else',
          OID
        ],
        [
          503,
          'directory-unavailable',
          'We could not reach the directory. Try again in a few minutes',
          OID
        ]
      ])(
        'says so on the person, keeps what was entered and shows the matches again, when the backend answers %i %s',
        async (status, code, message, chosen) => {
          backend('admin', {
            [`POST ${TEAM_PATH}/members`]: reply(status, { code }),
            [`POST ${SEARCH_PATH}`]: { items: [sam, alex] }
          })

          const { statusCode, result } = await add({
            oid: chosen,
            role: 'admin'
          })
          const $ = load(result)

          expect(statusCode).toBe(status)
          expect($('.govuk-error-summary__list a').attr('href')).toBe('#oid')
          expect($('#oid-error').text()).toContain(message)
          expect($('select[name="oid"]').val()).toBe(chosen)
          expect($('#search').attr('value')).toBe('sam')
          expect($('input[name="role"]:checked').attr('value')).toBe('admin')
          expect($('title').text()).toContain('Error: Add a member')
        }
      )

      test('says the add could not be completed, keeps the choice and uses a fresh key on the next try, when the backend refuses a reused key', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(409, {
            code: 'idempotency-key-reused'
          }),
          [`POST ${SEARCH_PATH}`]: { items: [sam, alex] }
        })

        const { statusCode, result } = await add({ role: 'admin' })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.conflict)
        expect($('.govuk-error-summary__list a').attr('href')).toBe('#oid')
        expect($('#oid-error').text()).toContain(
          'We could not add this person. Check the person and role, then select Add again'
        )
        expect(result).not.toContain('already a member')
        expect(result).not.toContain('No one found')
        expect($('select[name="oid"]').val()).toBe(OID)
        expect($('input[name="role"]:checked').attr('value')).toBe('admin')

        await add({ role: 'admin' })

        const keys = writes().map(
          ([, options]) => options.headers['idempotency-key']
        )

        expect(keys[0]).toMatch(UUID)
        expect(keys[1]).toMatch(UUID)
        expect(keys[1]).not.toBe(keys[0])
      })

      test('does not say no one was found beside "already a member", when the person has just been left out of the matches', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(409, { code: 'member-exists' }),
          [`POST ${SEARCH_PATH}`]: { items: [] }
        })

        const { statusCode, result } = await add()
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.conflict)
        expect($('.govuk-error-summary__list').text()).toContain(
          'This person is already a member of this team'
        )
        expect($('[data-testid="no-people"]')).toHaveLength(0)
        expect(result).not.toContain('No one found')
        expect($('#search-error').text()).toContain(
          'This person is already a member of this team'
        )
      })

      test('puts the error on the search text when the matches cannot be found again', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(503, {
            code: 'directory-unavailable'
          }),
          [`POST ${SEARCH_PATH}`]: reply(503, { code: 'directory-unavailable' })
        })

        const { statusCode, result } = await add()
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.serviceUnavailable)
        expect($('.govuk-error-summary__list a').attr('href')).toBe('#search')
        expect($('#search-error').text()).toContain(
          'We could not reach the directory'
        )
      })

      // The enhanced form submits what the field shows, "Name - email", as
      // `search`, and what was typed to find the person as `query`.
      describe('with script, where the field holds the label of the person chosen', () => {
        const LABEL = 'Sam Carter - sam.carter@defra.gov.uk'

        function addChosen(payload = {}) {
          return add({ search: LABEL, query: 'sam', ...payload })
        }

        test('adds the person chosen, whatever the length or format of the label', async () => {
          backend('admin', {
            [`POST ${TEAM_PATH}/members`]: reply(201, {
              member: { displayName: 'Sam Carter' }
            })
          })

          const long = `${'Dr Sam Carter-Smythe '.repeat(8)}- sam.carter@defra.gov.uk`
          const response = await addChosen({ search: long })

          expect(long.length).toBeGreaterThan(100)
          expect(response.statusCode).toBe(statusCodes.seeOther)
          expect(JSON.parse(writes()[0][1].body)).toEqual({
            oid: OID,
            role: 'user'
          })
          expect(searches()).toHaveLength(0)
        })

        test('looks for the person again with what was typed, not the label, and keeps the person chosen when the add fails', async () => {
          backend('admin', {
            [`POST ${TEAM_PATH}/members`]: reply(503, {
              code: 'directory-unavailable'
            }),
            [`POST ${SEARCH_PATH}`]: { items: [sam, alex] }
          })

          const { statusCode, result } = await addChosen()
          const $ = load(result)

          expect(statusCode).toBe(statusCodes.serviceUnavailable)
          expect(JSON.parse(searches()[0][1].body)).toEqual({ search: 'sam' })
          expect($('select[name="oid"]').val()).toBe(OID)
          expect($('#search').attr('value')).toBe(LABEL)
          expect($('#search').attr('data-people-query')).toBe('sam')
        })

        test('keeps the person chosen, with the label shown, when the matches no longer hold them or cannot be found', async () => {
          for (const search of [{ items: [alex] }, reply(503, {})]) {
            fetchMock.resetMocks()
            backend('admin', {
              [`POST ${TEAM_PATH}/members`]: reply(409, {
                code: 'member-exists'
              }),
              [`POST ${SEARCH_PATH}`]: search
            })

            const { result } = await addChosen()
            const $ = load(result)

            expect($('select[name="oid"] option:selected').attr('value')).toBe(
              OID
            )
            expect($('select[name="oid"] option:selected').text()).toBe(LABEL)
          }
        })

        test('keeps the person chosen, and does not refuse a label that is too long, when the role is missing', async () => {
          backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [sam] } })

          const { statusCode, result } = await addChosen({
            search: 'x'.repeat(150),
            role: undefined
          })
          const $ = load(result)

          expect(statusCode).toBe(statusCodes.badRequest)
          expect($('#role-error').text()).toContain('Select a role')
          expect($('#search-error')).toHaveLength(0)
          expect($('select[name="oid"]').val()).toBe(OID)
          expect(writes()).toHaveLength(0)
        })

        test('does not make up a person when no one was chosen', async () => {
          backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [alex] } })

          const { statusCode, result } = await addChosen({ oid: '' })
          const $ = load(result)

          expect(statusCode).toBe(statusCodes.badRequest)
          expect($('select[name="oid"] option')).toHaveLength(2)
          expect($('select[name="oid"]').val()).toBe('')
        })

        test('does not offer the text of a search as a person without script', async () => {
          backend('admin', {
            [`POST ${TEAM_PATH}/members`]: reply(409, {
              code: 'member-exists'
            }),
            [`POST ${SEARCH_PATH}`]: { items: [alex] }
          })

          const { result } = await add()
          const $ = load(result)

          expect($('select[name="oid"] option')).toHaveLength(2)
          expect($('#search').attr('data-people-query')).toBe('')
        })

        test('does not use what was typed when it is a search', async () => {
          backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [sam] } })

          const { statusCode } = await post(`${MEMBERS_URL}/add`, {
            action: 'search',
            search: 'sam',
            query: 'other'
          })

          expect(statusCode).toBe(statusCodes.ok)
          expect(JSON.parse(searches()[0][1].body)).toEqual({ search: 'sam' })
        })
      })

      test('shows the page for a refusal that arrives after the team was read, and fails on anything else', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(403, { code: 'admin-required' })
        })

        const refused = await add()

        expect(refused.statusCode).toBe(statusCodes.forbidden)

        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(500, { code: 'internal' })
        })

        const failed = await add()

        expect(failed.statusCode).toBe(statusCodes.internalServerError)
      })
    })
  })

  describe('changing a role', () => {
    const ROLE_URL = `${MEMBERS_URL}/member-2/role`

    test('for a person with only their own keys: is not found', async () => {
      backend(null)

      const page = await get(ROLE_URL)
      const submitted = await post(ROLE_URL, { role: 'user' })

      expect(page.statusCode).toBe(statusCodes.notFound)
      expect(submitted.statusCode).toBe(statusCodes.notFound)
      expect(writes()).toHaveLength(0)
    })

    test('for a member: says only an admin can, and changes nothing', async () => {
      backend('user')

      const page = await get(ROLE_URL)
      const mine = await get(`${MEMBERS_URL}/me/role`)
      const submitted = await post(ROLE_URL, { role: 'user' })
      const invalid = await post(ROLE_URL, { role: 'owner' })

      for (const response of [page, mine, submitted, invalid]) {
        expect(response.statusCode).toBe(statusCodes.forbidden)
        expect(response.result).toContain(
          'Only an admin of Flood Risk Team can change roles.'
        )
      }

      expect(writes()).toHaveLength(0)
    })

    test('for an admin changing someone else: names them, shows their role, and links to remove them', async () => {
      backend('admin')

      const { statusCode, result } = await get(ROLE_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('.govuk-back-link').attr('href')).toBe(MEMBERS_URL)
      expect($('[data-testid="app-heading-caption"]').text()).toBe(
        'Flood Risk Team'
      )
      expect($('h1').text()).toBe('Change Priya Raman’s role')
      expect($('input[name="role"]:checked').attr('value')).toBe('admin')
      expect($('[data-testid="save-role"]').text().trim()).toBe('Save role')
      expect($('[data-testid="remove-member-link"]').text()).toBe(
        'Remove Priya Raman from this team'
      )
      expect($('[data-testid="remove-member-link"]').attr('href')).toBe(
        `${MEMBERS_URL}/member-2/remove`
      )
    })

    test('for an admin changing their own: says "your", and keeps "me" in the address', async () => {
      backend('admin')

      const { result } = await get(`${MEMBERS_URL}/me/role`)
      const $ = load(result)

      expect($('h1').text()).toBe('Change your role')
      expect($('[data-testid="remove-member-link"]').text()).toBe(
        'Remove yourself from this team'
      )
      expect($('[data-testid="remove-member-link"]').attr('href')).toBe(
        `${MEMBERS_URL}/me/remove`
      )
    })

    test('knows the person by their own id as well as by "me"', async () => {
      backend('admin')

      const { result } = await get(`${MEMBERS_URL}/member-1/role`)

      expect(load(result)('h1').text()).toBe('Change your role')
    })

    test('names any other member by their name', async () => {
      backend('admin')

      const { result } = await get(`${MEMBERS_URL}/member-3/role`)

      expect(load(result)('h1').text()).toBe('Change Tom Ellis’s role')
    })

    test('is not found for someone who is not in the team', async () => {
      backend('admin')

      const { statusCode, result } = await get(`${MEMBERS_URL}/member-9/role`)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Member not found')
    })

    test('saves the role the backend is sent, and goes back to the Members tab with a banner', async () => {
      backend('admin', {
        [`PATCH ${TEAM_PATH}/members/member-2`]: { member: priya('user') }
      })

      const response = await post(ROLE_URL, { role: 'user' })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(MEMBERS_URL)

      const [[url, options]] = writes()

      expect(url).toContain(`${TEAM_PATH}/members/member-2`)
      expect(options.method).toBe('PATCH')
      expect(JSON.parse(options.body)).toEqual({ role: 'user' })
      expect(options.headers['x-user-id']).toBe('user-1')
      expect((await follow(response)).result).toContain(
        'Priya Raman is now a member.'
      )
    })

    test.each([
      ['admin', 'You are now an admin.'],
      ['user', 'You are now a member.']
    ])('says "%s" for yourself as "%s"', async (role, message) => {
      backend('admin', {
        [`PATCH ${TEAM_PATH}/members/member-1`]: { member: you(role) }
      })

      const response = await post(`${MEMBERS_URL}/me/role`, { role })

      expect(writes()[0][0]).toContain(`${TEAM_PATH}/members/member-1`)
      expect((await follow(response)).result).toContain(message)
    })

    test('says what to do when you are the only admin, on the field and in the summary', async () => {
      backend('admin', {
        [`PATCH ${TEAM_PATH}/members/member-1`]: lastAdmin
      })

      const { statusCode, result } = await post(`${MEMBERS_URL}/me/role`, {
        role: 'user'
      })
      const $ = load(result)
      const message =
        'You are the only admin. Add another admin before you change your role.'

      expect(statusCode).toBe(statusCodes.conflict)
      expect($('.govuk-error-summary__title').text().trim()).toBe(
        'There is a problem'
      )
      expect($('.govuk-error-summary__list a').text()).toBe(message)
      expect($('.govuk-error-summary__list a').attr('href')).toBe('#role')
      expect($('#role-error').text()).toContain(message)
      expect($('h1').text()).toBe('Change your role')
      expect($('input[name="role"]:checked').attr('value')).toBe('user')
      expect($('[data-testid="remove-member-link"]')).toHaveLength(1)
    })

    test('says what to do when the team would be left without an admin by changing someone else', async () => {
      backend('admin', {
        [`PATCH ${TEAM_PATH}/members/member-2`]: lastAdmin
      })

      const { result } = await post(ROLE_URL, { role: 'user' })

      expect(load(result)('#role-error').text()).toContain(
        'A team must keep at least one admin. Add another admin before you change Priya Raman’s role.'
      )
    })

    test('shows an error for a role that is not one, and changes nothing', async () => {
      backend('admin')

      const { statusCode, result } = await post(ROLE_URL, { role: 'owner' })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('#role-error').text()).toContain('Select a role')
      expect($('input[name="role"]:checked').attr('value')).toBe('admin')
      expect(writes()).toHaveLength(0)
    })

    test.each([
      [403, 'Only a team admin can do that'],
      [404, 'Member not found']
    ])(
      'shows the page for a refusal (%i) that arrives after the team was read',
      async (status, heading) => {
        backend('admin', {
          [`PATCH ${TEAM_PATH}/members/member-2`]: reply(status, {
            code: 'refused'
          })
        })

        const { statusCode, result } = await post(ROLE_URL, { role: 'user' })

        expect(statusCode).toBe(status)
        expect(result).toContain(heading)
      }
    )

    test('fails on a fault in the backend', async () => {
      backend('admin', {
        [`PATCH ${TEAM_PATH}/members/member-2`]: reply(500, {
          code: 'internal'
        })
      })

      const { statusCode } = await post(ROLE_URL, { role: 'user' })

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  describe('removing a person', () => {
    const REMOVE_URL = `${MEMBERS_URL}/member-2/remove`

    test('for a person with only their own keys: is not found', async () => {
      backend(null)

      const page = await get(REMOVE_URL)
      const submitted = await post(REMOVE_URL)

      expect(page.statusCode).toBe(statusCodes.notFound)
      expect(submitted.statusCode).toBe(statusCodes.notFound)
      expect(writes()).toHaveLength(0)
    })

    test('for a member: says only an admin can, and removes no one', async () => {
      backend('user')

      const page = await get(REMOVE_URL)
      const submitted = await post(REMOVE_URL)

      for (const response of [page, submitted]) {
        expect(response.statusCode).toBe(statusCodes.forbidden)
        expect(response.result).toContain(
          'Only an admin of Flood Risk Team can remove people.'
        )
      }

      expect(writes()).toHaveLength(0)
    })

    test('for an admin: warns that the client secret is not changed, and offers to remove or cancel', async () => {
      backend('admin')

      const { statusCode, result } = await get(REMOVE_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text()).toBe('Remove Priya Raman from Flood Risk Team?')
      expect($('.govuk-back-link').attr('href')).toBe(roleUrl('member-2'))
      expect($('.govuk-warning-text__text').text()).toContain(
        'Removing someone does not change the client secret. Rotate it if they had a copy.'
      )
      expect($('[data-testid="remove-member-confirm"]').text().trim()).toBe(
        'Remove Priya Raman'
      )
      expect(
        $('[data-testid="remove-member-confirm"]').hasClass(
          'govuk-button--warning'
        )
      ).toBe(true)
      expect($('[data-testid="remove-member-cancel"]').attr('href')).toBe(
        MEMBERS_URL
      )
    })

    test('names yourself the same way, and keeps "me" in the address back', async () => {
      backend('admin')

      const { result } = await get(`${MEMBERS_URL}/me/remove`)
      const $ = load(result)

      expect($('h1').text()).toBe('Remove Test User from Flood Risk Team?')
      expect($('.govuk-back-link').attr('href')).toBe(roleUrl('me'))
    })

    test('removes the person and goes back to the Members tab with a banner', async () => {
      backend('admin', { [`DELETE ${TEAM_PATH}/members/member-2`]: reply(204) })

      const response = await post(REMOVE_URL)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(MEMBERS_URL)

      const [[url, options]] = writes()

      expect(url).toContain(`${TEAM_PATH}/members/member-2`)
      expect(options.method).toBe('DELETE')
      expect(options.headers['x-user-id']).toBe('user-1')
      expect((await follow(response)).result).toContain(
        'Priya Raman has been removed from Flood Risk Team.'
      )
    })

    test('removes yourself and goes to the Teams list, where the team is no longer shown, with a banner', async () => {
      backend('admin', { [`DELETE ${TEAM_PATH}/members/member-1`]: reply(204) })

      const response = await post(`${MEMBERS_URL}/me/remove`)

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe('/teams')
      expect((await follow(response)).result).toContain(
        'You have been removed from Flood Risk Team.'
      )
    })

    test('says what to do when you are the only admin', async () => {
      backend('admin', {
        [`DELETE ${TEAM_PATH}/members/member-1`]: lastAdmin
      })

      const { statusCode, result } = await post(`${MEMBERS_URL}/me/remove`)
      const $ = load(result)
      const message =
        'You are the only admin. Add another admin before you remove yourself from this team.'

      expect(statusCode).toBe(statusCodes.conflict)
      expect($('.govuk-error-summary__list a').text()).toBe(message)
      expect($('.govuk-error-summary__list a').attr('href')).toBe(
        '#remove-member'
      )
      expect($('#remove-member')).toHaveLength(1)
      expect($('h1').text()).toBe('Remove Test User from Flood Risk Team?')
    })

    test('says what to do when removing someone else would leave the team without an admin', async () => {
      backend('admin', {
        [`DELETE ${TEAM_PATH}/members/member-2`]: lastAdmin
      })

      const { result } = await post(REMOVE_URL)

      expect(load(result)('.govuk-error-summary__list a').text()).toBe(
        'A team must keep at least one admin. Add another admin before you remove Priya Raman from this team.'
      )
    })

    test('is not found for someone who has already been removed', async () => {
      backend('admin')

      const { statusCode, result } = await post(
        `${MEMBERS_URL}/member-9/remove`
      )

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Member not found')
      expect(writes()).toHaveLength(0)
    })

    test('fails on a fault in the backend', async () => {
      backend('admin', {
        [`DELETE ${TEAM_PATH}/members/member-2`]: reply(500, {
          code: 'internal'
        })
      })

      const { statusCode } = await post(REMOVE_URL)

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('shows the page for a refusal that arrives after the team was read', async () => {
      backend('admin', {
        [`DELETE ${TEAM_PATH}/members/member-2`]: reply(403, {
          code: 'admin-required'
        })
      })

      const { statusCode } = await post(REMOVE_URL)

      expect(statusCode).toBe(statusCodes.forbidden)
    })
  })
})

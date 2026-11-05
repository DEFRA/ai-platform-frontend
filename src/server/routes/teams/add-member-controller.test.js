import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { reply } from '#/test-helpers/api-mock.js'
import {
  signInViaOidc,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import { sampleTeam } from '#/test-helpers/team-connect-helpers.js'
import {
  MEMBERS_URL,
  TEAM_PATH,
  membersHelpers,
  priya,
  you
} from '#/test-helpers/members-test-helpers.js'
import { MAX_KEYS } from './add-member-keys.js'

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

describe('#add member', () => {
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

  const { backend, get, post, follow, writes } = membersHelpers({
    fetchMock,
    getServer: () => server,
    getCookies: () => cookies
  })

  // The idempotency key a page of the add form carries.
  function formKey({ result }) {
    return load(result)('input[name="idempotencyKey"]').attr('value')
  }

  // A search is a POST that changes nothing, so it is not a write.
  function searches() {
    return fetchMock.mock.calls.filter(([url]) =>
      url.includes('/people/search')
    )
  }

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
      expect($('input[name="idempotencyKey"]').attr('type')).toBe('hidden')
      expect($('input[name="idempotencyKey"]').attr('value')).toMatch(UUID)
      expect(searches()).toHaveLength(0)
    })

    test('issues a key for each time the form is shown, so a second tab has its own', async () => {
      backend('admin')

      const first = await get(`${MEMBERS_URL}/add`)
      const second = await get(`${MEMBERS_URL}/add`)

      expect(formKey(first)).toMatch(UUID)
      expect(formKey(second)).toMatch(UUID)
      expect(formKey(second)).not.toBe(formKey(first))
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
        expect(searches()[0][1].headers).not.toHaveProperty('x-user-id')
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
        expect(options.headers).not.toHaveProperty('x-user-id')
        expect(options.headers['idempotency-key']).toMatch(UUID)

        const { result } = await follow(response)

        expect(result).toContain('Sam Carter has been added')
        expect(result).toContain('They can use the team straight away.')
      })

      // The idempotency key of each add the backend was sent, in order.
      function sentKeys() {
        return writes().map(([, options]) => options.headers['idempotency-key'])
      }

      describe('the idempotency key of each add', () => {
        const unavailable = reply(503, { code: 'directory-unavailable' })

        // Opens the form, as a tab does, and gives the key it carries.
        async function openForm() {
          return formKey(await get(`${MEMBERS_URL}/add`))
        }

        test('sends one key for a retry of the same person and role, made from the form’s key, so it adds once', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const key = await openForm()
          const failed = await add({ idempotencyKey: key })

          expect(failed.statusCode).toBe(statusCodes.serviceUnavailable)
          expect(formKey(failed)).toBe(key)

          await add({ idempotencyKey: formKey(failed) })

          const [first, second] = sentKeys()

          expect(first).toMatch(UUID)
          expect(first).not.toBe(key)
          expect(second).toBe(first)
        })

        test('sends the same key from overlapping submits of one form', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const key = await openForm()

          await Promise.all([
            add({ idempotencyKey: key }),
            add({ idempotencyKey: key })
          ])

          const [first, second] = sentKeys()

          expect(first).toMatch(UUID)
          expect(second).toBe(first)
        })

        test('keeps the key of each tab, so a retry of the first add replays it after another tab has added someone else (A, B, retry A)', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const tabA = await openForm()
          const tabB = await openForm()

          await add({ idempotencyKey: tabA })
          await add({ idempotencyKey: tabB, oid: OTHER_OID })
          await add({ idempotencyKey: tabA })

          const [a, b, again] = sentKeys()

          expect(tabB).not.toBe(tabA)
          expect(b).not.toBe(a)
          expect(again).toBe(a)
        })

        test('keeps the key of the first choice in one form when the admin changes their mind and back (A, B, retry A)', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const key = await openForm()

          await add({ idempotencyKey: key })
          await add({ idempotencyKey: key, oid: OTHER_OID })
          await add({ idempotencyKey: key })

          const [a, b, again] = sentKeys()

          expect(b).not.toBe(a)
          expect(again).toBe(a)
        })

        test('sends the same key for a retry of the second choice of a form after another tab has added someone (A fails, B fails, another tab adds, retry B) (thread r4468860426)', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const tabA = await openForm()
          const tabB = await openForm()

          const failedA = await add({ idempotencyKey: tabA })
          const failedB = await add({
            idempotencyKey: formKey(failedA),
            oid: OTHER_OID
          })

          backend('admin', {
            [`POST ${TEAM_PATH}/members`]: reply(201, {
              member: { displayName: 'Sam Carter' }
            })
          })
          await add({ idempotencyKey: tabB })
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          await add({ idempotencyKey: formKey(failedB), oid: OTHER_OID })
          await add({ idempotencyKey: formKey(failedA) })

          const [a, b, , retriedB, retriedA] = sentKeys()

          expect(b).not.toBe(a)
          expect(retriedB).toBe(b)
          expect(retriedA).toBe(a)
        })

        test('returns the key of the form, never a key made from the choice, when an add fails, and the key it returns is recognised', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const key = await openForm()
          const failed = await add({ idempotencyKey: key, oid: OTHER_OID })

          expect(formKey(failed)).toBe(key)
          expect(sentKeys()[0]).not.toBe(key)

          const retried = await add({
            idempotencyKey: formKey(failed),
            oid: OTHER_OID
          })

          expect(formKey(retried)).toBe(key)
          expect(sentKeys()[1]).toBe(sentKeys()[0])
        })

        test('never uses one key for a different person or a different role, and the form comes back with its own key', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const key = await openForm()
          const asUser = await add({ idempotencyKey: key })
          const other = await add({ idempotencyKey: key, oid: OTHER_OID })
          const otherAdmin = await add({
            idempotencyKey: key,
            oid: OTHER_OID,
            role: 'admin'
          })
          const retried = await add({
            idempotencyKey: formKey(otherAdmin),
            oid: OTHER_OID,
            role: 'admin'
          })

          const keys = sentKeys()

          expect(new Set(keys.slice(0, 3)).size).toBe(3)
          expect(keys[3]).toBe(keys[2])
          expect(formKey(asUser)).toBe(key)
          expect(formKey(other)).toBe(key)
          expect(formKey(retried)).toBe(key)
        })

        test('replays a person who was added when the same form is sent again, and gives a new form a new key', async () => {
          backend('admin', {
            [`POST ${TEAM_PATH}/members`]: reply(201, {
              member: { displayName: 'Sam Carter' }
            })
          })

          const key = await openForm()
          const added = await add({ idempotencyKey: key })
          const again = await add({ idempotencyKey: key })

          expect(added.statusCode).toBe(statusCodes.seeOther)
          expect(again.statusCode).toBe(statusCodes.seeOther)
          expect(sentKeys()).toHaveLength(2)
          expect(sentKeys()[1]).toBe(sentKeys()[0])
          expect(sentKeys()[0]).toMatch(UUID)
          expect(await openForm()).not.toBe(key)
        })

        test('makes a key of its own when the form carried none, a malformed one, or one this session did not issue, the same for the same person and role', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const forged = '2f6a8e0c-9d2b-4a3e-8b57-6a1c0f3d9e11'

          for (const idempotencyKey of [undefined, '', 'not a key', forged]) {
            const { statusCode } = await add({ idempotencyKey })

            expect(statusCode).toBe(statusCodes.serviceUnavailable)
          }

          const keys = sentKeys()

          expect(keys).toHaveLength(4)
          expect(new Set(keys).size).toBe(1)
          expect(keys.every((key) => UUID.test(key))).toBe(true)
          expect(keys).not.toContain(forged)
        })

        test('sends one key from overlapping submits that have no key this session issued', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          await Promise.all([
            add({ idempotencyKey: undefined }),
            add({ idempotencyKey: undefined }),
            add({ idempotencyKey: undefined })
          ])

          const keys = sentKeys()

          expect(keys).toHaveLength(3)
          expect(new Set(keys).size).toBe(1)
        })

        test('makes a new key for the next add of the same person and role without a form key, once the first has succeeded', async () => {
          backend('admin', {
            [`POST ${TEAM_PATH}/members`]: reply(201, {
              member: { displayName: 'Sam Carter' }
            })
          })

          await add({ idempotencyKey: undefined })
          await add({ idempotencyKey: undefined })

          const [first, second] = sentKeys()

          expect(first).toMatch(UUID)
          expect(second).toMatch(UUID)
          expect(second).not.toBe(first)
        })

        test('keeps a person’s key to their own session', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const key = await openForm()

          cookies = await signInViaOidc(server, fetchMock)
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })
          await add({ idempotencyKey: key })

          expect(sentKeys()[0]).not.toBe(key)
        })

        test('forgets the oldest keys, so a session holds a bounded few', async () => {
          backend('admin', { [`POST ${TEAM_PATH}/members`]: unavailable })

          const oldest = await openForm()
          let newest

          for (let tab = 0; tab < MAX_KEYS; tab++) {
            newest = await openForm()
          }

          await add({ idempotencyKey: oldest })
          await add({ idempotencyKey: newest })
          await add({ idempotencyKey: undefined })

          const [first, last, keyless] = sentKeys()

          // The evicted key is treated as no key; the newest is still known.
          expect(first).toBe(keyless)
          expect(last).not.toBe(keyless)
          expect(last).toMatch(UUID)
        }, 30_000)

        test('carries the key on every page of the form: a search, and a refusal to add', async () => {
          backend('admin', {
            [`POST ${SEARCH_PATH}`]: { items: [sam] },
            [`POST ${TEAM_PATH}/members`]: unavailable
          })

          const key = await openForm()
          const searched = await post(`${MEMBERS_URL}/add`, {
            action: 'search',
            search: 'sam',
            idempotencyKey: key
          })
          const refused = await add({ idempotencyKey: key, role: undefined })

          expect(formKey(searched)).toBe(key)
          expect(refused.statusCode).toBe(statusCodes.badRequest)
          expect(formKey(refused)).toBe(key)
        })

        test('carries a new key when a search comes with one that is not known', async () => {
          backend('admin', { [`POST ${SEARCH_PATH}`]: { items: [sam] } })

          const searched = await post(`${MEMBERS_URL}/add`, {
            action: 'search',
            search: 'sam',
            idempotencyKey: 'not a key'
          })

          expect(formKey(searched)).toMatch(UUID)
        })
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

      test('says the add could not be completed, keeps the choice and carries a fresh key on the form, when the backend refuses a reused key', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(409, {
            code: 'idempotency-key-reused'
          }),
          [`POST ${SEARCH_PATH}`]: { items: [sam, alex] }
        })

        const key = formKey(await get(`${MEMBERS_URL}/add`))
        const refused = await add({ role: 'admin', idempotencyKey: key })
        const { statusCode, result } = refused
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
        expect(formKey(refused)).toMatch(UUID)
        expect(formKey(refused)).not.toBe(key)

        await add({ role: 'admin', idempotencyKey: formKey(refused) })

        const keys = writes().map(
          ([, options]) => options.headers['idempotency-key']
        )

        expect(keys[0]).toMatch(UUID)
        expect(keys[1]).toMatch(UUID)
        expect(keys[1]).not.toBe(keys[0])
      })

      test('sends a fresh key, not the one the backend refused, for a keyless retry after a refusal of a reused key', async () => {
        backend('admin', {
          [`POST ${TEAM_PATH}/members`]: reply(409, {
            code: 'idempotency-key-reused'
          }),
          [`POST ${SEARCH_PATH}`]: { items: [sam] }
        })

        // No key the session issued, so the first key is the one made from
        // the operation; the refusal moves the session on from it.
        await add({ idempotencyKey: undefined })
        await add({ idempotencyKey: undefined })

        const [first, second] = writes().map(
          ([, options]) => options.headers['idempotency-key']
        )

        expect(second).toMatch(UUID)
        expect(second).not.toBe(first)
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

      test('fails on a fault of its own, which is not the backend refusing, when the add is made', async () => {
        fetchMock.mockResponse(async (request) =>
          request.method === 'POST' && request.url.endsWith('/members')
            ? 'not json'
            : JSON.stringify({
                team: sampleTeam,
                members: [you('admin'), priya()],
                environments: []
              })
        )

        const { statusCode } = await add()

        expect(statusCode).toBe(statusCodes.internalServerError)
      })
    })
  })
})

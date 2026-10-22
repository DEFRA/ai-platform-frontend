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
  userId: null,
  displayName: null,
  email: 'tom.ellis@defra.gov.uk',
  role: 'user',
  status: 'invited'
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
  // admin and Tom invited; or (no role) is not in the team at all, which the
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

  function writes() {
    return fetchMock.mock.calls.filter(
      ([url, options]) =>
        url.includes('/v1/teams') && options?.method && options.method !== 'GET'
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
        'Not signed in yet',
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
      expect($('[data-testid="member-not-signed-in"]').text()).toContain(
        'Not signed in yet'
      )
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
    test('names a person who has not signed in by their address for a screen reader', async () => {
      backend('admin')

      const { result } = await get(MEMBERS_URL)

      expect(result).toContain(
        'Change<span class="govuk-visually-hidden"> role of tom.ellis@defra.gov.uk'
      )
    })

    test('shows a creator with no address as the team creator', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: {
          team: sampleTeam,
          members: [{ ...you('admin'), email: undefined }],
          environments: []
        }
      })

      const { result } = await get(MEMBERS_URL)

      expect(result).toContain('Team creator')
    })

    test('shows the person’s own name from their session before they have one on record', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: {
          team: sampleTeam,
          members: [{ ...you('admin'), displayName: null }],
          environments: []
        }
      })

      const { result } = await get(MEMBERS_URL)

      expect(result).toContain('Test User (you)')
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
      ['adding a member', `${MEMBERS_URL}/add`, { email: 'nope' }],
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
        email: 'new.person@defra.gov.uk'
      })

      expect(page.statusCode).toBe(statusCodes.notFound)
      expect(submitted.statusCode).toBe(statusCodes.notFound)
      expect(writes()).toHaveLength(0)
    })

    test('for a member: says only an admin can, and does not add anyone', async () => {
      backend('user')

      const page = await get(`${MEMBERS_URL}/add`)
      const submitted = await post(`${MEMBERS_URL}/add`, {
        email: 'new.person@defra.gov.uk'
      })
      const invalid = await post(`${MEMBERS_URL}/add`, { email: 'nope' })

      for (const response of [page, submitted, invalid]) {
        expect(response.statusCode).toBe(statusCodes.forbidden)
        expect(response.result).toContain(
          'Only an admin of Flood Risk Team can add people.'
        )
        expect(response.result).toContain(`href="${MEMBERS_URL}"`)
      }

      expect(writes()).toHaveLength(0)
    })

    test('for an admin: asks for an address and a role, Member being the default, with no email promise', async () => {
      backend('admin')

      const { statusCode, result } = await get(`${MEMBERS_URL}/add`)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('.govuk-back-link').attr('href')).toBe(MEMBERS_URL)
      expect($('[data-testid="app-heading-caption"]').text()).toBe(
        'Flood Risk Team'
      )
      expect($('h1').text()).toBe('Add a member')
      expect($('label[for="email"]').text().trim()).toBe('Email address')
      expect($('#email-hint').text().trim()).toBe(
        'Their Defra work address, for example name@defra.gov.uk'
      )
      expect($('input[name="role"]:checked').attr('value')).toBe('user')
      expect($('.govuk-inset-text').text().trim()).toBe(
        'They will see the team when they next sign in.'
      )
      expect($('[data-testid="add-member-submit"]').text().trim()).toBe(
        'Add a member'
      )
      expect(result).not.toContain('email them')
    })

    test('adds the person with the address and role, once, and goes back to the Members tab with a banner', async () => {
      backend('admin', {
        [`POST ${TEAM_PATH}/members`]: reply(201, {
          member: { _id: 'member-4', status: 'invited' }
        })
      })

      const response = await post(`${MEMBERS_URL}/add`, {
        email: ' New.Person@defra.gov.uk ',
        role: 'admin'
      })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(response.headers.location).toBe(MEMBERS_URL)

      const [[url, options]] = writes()

      expect(url).toContain(`${TEAM_PATH}/members`)
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual({
        email: 'New.Person@defra.gov.uk',
        role: 'admin'
      })
      expect(options.headers['x-user-id']).toBe('user-1')
      expect(options.headers['idempotency-key']).toEqual(expect.any(String))

      const { result } = await follow(response)

      expect(result).toContain('New.Person@defra.gov.uk has been added')
      expect(result).toContain('They will see the team when they next sign in.')
    })

    test('adds a member when no role is chosen', async () => {
      backend('admin', {
        [`POST ${TEAM_PATH}/members`]: reply(201, { member: {} })
      })

      await post(`${MEMBERS_URL}/add`, { email: 'new.person@defra.gov.uk' })

      expect(JSON.parse(writes()[0][1].body).role).toBe('user')
    })

    test.each([
      ['', 'Enter an email address'],
      [
        'not-an-address',
        'Enter an email address in the correct format, like name@defra.gov.uk'
      ]
    ])(
      'shows an error for the address "%s", keeps what was typed and adds no one',
      async (email, message) => {
        backend('admin')

        const { statusCode, result } = await post(`${MEMBERS_URL}/add`, {
          email,
          role: 'admin'
        })
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('.govuk-error-summary__list a').attr('href')).toBe('#email')
        expect($('.govuk-error-summary__list').text()).toContain(message)
        expect($('#email-error').text()).toContain(message)
        expect($('#email').attr('value')).toBe(email)
        expect($('input[name="role"]:checked').attr('value')).toBe('admin')
        expect($('title').text()).toContain('Error: Add a member')
        expect(writes()).toHaveLength(0)
      }
    )

    test('shows an error for a role that is not one', async () => {
      backend('admin')

      const { statusCode, result } = await post(`${MEMBERS_URL}/add`, {
        email: 'new.person@defra.gov.uk',
        role: 'owner'
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(load(result)('#role-error').text()).toContain('Select a role')
      expect(writes()).toHaveLength(0)
    })

    test('says so on the address when the person is already a member', async () => {
      backend('admin', {
        [`POST ${TEAM_PATH}/members`]: reply(409, {
          code: 'member-exists',
          message: 'This person is already a member of the team'
        })
      })

      const { statusCode, result } = await post(`${MEMBERS_URL}/add`, {
        email: 'priya.raman@defra.gov.uk',
        role: 'user'
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.conflict)
      expect($('#email-error').text()).toContain(
        'This person is already a member of this team'
      )
      expect($('#email').attr('value')).toBe('priya.raman@defra.gov.uk')
    })

    test('shows the page for a refusal that arrives after the team was read, and fails on anything else', async () => {
      backend('admin', {
        [`POST ${TEAM_PATH}/members`]: reply(403, { code: 'admin-required' })
      })

      const refused = await post(`${MEMBERS_URL}/add`, {
        email: 'new.person@defra.gov.uk'
      })

      expect(refused.statusCode).toBe(statusCodes.forbidden)

      backend('admin', {
        [`POST ${TEAM_PATH}/members`]: reply(500, { code: 'internal' })
      })

      const failed = await post(`${MEMBERS_URL}/add`, {
        email: 'new.person@defra.gov.uk'
      })

      expect(failed.statusCode).toBe(statusCodes.internalServerError)
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

    test('names a person who has not signed in by their address', async () => {
      backend('admin')

      const { result } = await get(`${MEMBERS_URL}/member-3/role`)

      expect(load(result)('h1').text()).toBe(
        'Change tom.ellis@defra.gov.uk’s role'
      )
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

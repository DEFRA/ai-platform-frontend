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
import {
  MEMBERS_URL,
  TEAM_PATH,
  membersHelpers,
  priya,
  you
} from '#/test-helpers/members-test-helpers.js'

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

  const { backend, get, post, follow, writes } = membersHelpers({
    fetchMock,
    getServer: () => server,
    getCookies: () => cookies
  })

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

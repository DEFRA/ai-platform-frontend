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

const AUDIT = '/v1/admin/audit'

const FORBIDDEN = reply(403, {
  statusCode: 403,
  error: 'Forbidden',
  message: 'Forbidden',
  code: 'platform-admin-required'
})

const OPTIONS = {
  teams: [
    { id: 'team-1', name: 'Flood Risk Team' },
    { id: 'team-2', name: 'Air Quality Team' }
  ],
  environments: ['infradev', 'prod']
}

function event(overrides = {}) {
  return {
    id: 'e1',
    at: '2026-10-30T14:05:00.000Z',
    action: 'team.addMember',
    outcome: 'success',
    code: null,
    reason: null,
    resource: 'team',
    actor: { type: 'platform-admin', displayName: 'Priya Raman' },
    subject: { displayName: 'Jo Smith' },
    team: { id: 'team-1', name: 'Flood Risk Team' },
    environment: null,
    ...overrides
  }
}

function listing(events = [event()], overrides = {}) {
  return {
    events,
    page: 1,
    pageSize: 25,
    total: events.length,
    retentionDays: 30,
    options: OPTIONS,
    ...overrides
  }
}

describe('#admin audit log', () => {
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

  function adminCalls() {
    return fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter(({ pathname }) => pathname.startsWith('/v1/admin'))
      .map(({ pathname, search }) => `${pathname}${search}`)
  }

  function cells(row, $) {
    return $(row)
      .find('td')
      .map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
      .get()
  }

  test('redirects a signed out person to sign in, and asks the backend nothing', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/admin/audit'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toContain('/sign-in')
    expect(adminCalls()).toEqual([])
  })

  describe('the page', () => {
    test('is the Audit log tab of the Admin area, with the current tab marked', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const { statusCode, result } = await get('/admin/audit')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(adminCalls()).toEqual([AUDIT])
      expect($('title').text()).toContain('Audit log - Admin')
      expect($('title').text()).not.toContain('Error:')
      expect($('h1').text()).toBe('Audit log')
      expect($('[data-testid="app-heading-caption"]').text()).toBe('Admin')
      expect(
        $('[data-testid="sub-navigation"] a')
          .map((_, link) => `${$(link).text().trim()} ${$(link).attr('href')}`)
          .get()
      ).toEqual([
        'Teams /admin/teams',
        'Deployments /admin/deployments',
        'Audit log /admin/audit'
      ])
      expect(
        $('[data-testid="sub-navigation"] [aria-current="page"]').text()
      ).toBe('Audit log')
      expect(
        $('.govuk-breadcrumbs__list-item')
          .map((_, item) => $(item).text().trim())
          .get()
      ).toEqual(['Home', 'Admin', 'Audit log'])
    })

    test('lists each event: when, who and their type, the action with the person affected, team, environment and outcome', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing(
          [
            event({ environment: 'infradev' }),
            event({
              id: 'e2',
              at: '2026-10-29T09:00:00.000Z',
              action: 'team.create',
              actor: { type: 'team-admin', displayName: 'Amelia Ford' },
              subject: null,
              team: { id: 'team-2', name: 'Air Quality Team' }
            })
          ],
          { total: 2 }
        )
      })

      const $ = load((await get('/admin/audit')).result)
      const rows = $('[data-testid="audit-row"]')

      expect(rows).toHaveLength(2)
      expect(cells(rows[0], $)).toEqual([
        '30 October 2026, 2:05pm',
        'Priya Raman Platform Admin',
        'Added a member Person affected: Jo Smith',
        'Flood Risk Team',
        'Development',
        'Done'
      ])
      expect(cells(rows[1], $)).toEqual([
        '29 October 2026, 9:00am',
        'Amelia Ford Team Admin',
        'Created a team',
        'Air Quality Team',
        'None',
        'Done'
      ])
      expect(rows.eq(0).find('time').attr('datetime')).toBe(
        '2026-10-30T14:05:00.000Z'
      )
      expect($('[data-testid="audit-count"]').text()).toBe(
        'Showing 1 to 2 of 2 events. Events are kept for 30 days.'
      )
    })

    test('has a hidden caption, column headers and a table in a focusable scroll region', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const $ = load((await get('/admin/audit')).result)

      expect($('caption').text()).toBe('Audit events')
      expect($('caption').attr('class')).toContain('govuk-visually-hidden')
      expect($('.app-table-scroll').attr('role')).toBe('region')
      expect($('.app-table-scroll').attr('tabindex')).toBe('0')
      expect($('.app-table-scroll').attr('aria-label')).toBe('Audit events')
      expect(
        $('th')
          .map((_, header) => $(header).text().trim())
          .get()
      ).toEqual(['When', 'Who', 'Action', 'Team', 'Environment', 'Outcome'])
    })

    test('shows the time in UK time, winter and summer', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([
          event({ at: '2026-10-30T14:05:00.000Z' }),
          event({ id: 'e2', at: '2026-07-15T13:05:00.000Z' })
        ])
      })

      const $ = load((await get('/admin/audit')).result)
      const whens = $('[data-testid="audit-row"] td:first-child')
        .map((_, cell) => $(cell).text().trim())
        .get()

      expect(whens).toEqual(['30 October 2026, 2:05pm', '15 July 2026, 2:05pm'])
    })

    test('says each outcome in words in a tag: Done, Failed and Refused', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([
          event({ id: 'a' }),
          event({ id: 'b', outcome: 'failure', code: 'upstream-unavailable' }),
          event({
            id: 'c',
            action: 'access.denied',
            outcome: 'failure',
            code: 'admin-required',
            subject: null
          })
        ])
      })

      const $ = load((await get('/admin/audit')).result)
      const tags = $('[data-testid="audit-row"] .govuk-tag')

      expect(tags.map((_, tag) => $(tag).text().trim()).get()).toEqual([
        'Done',
        'Failed',
        'Refused'
      ])
      expect(tags.eq(0).attr('class')).toContain('govuk-tag--green')
      expect(tags.eq(1).attr('class')).toContain('govuk-tag--red')
      expect(tags.eq(2).attr('class')).toContain('govuk-tag--orange')
      expect(
        $('[data-testid="audit-row"]').eq(2).find('td').eq(2).text()
      ).toContain('Refused: Team Admin role needed')
    })

    test('puts the reason under the action, as the backend gave it, escaped', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([
          event({
            action: 'credential.reveal',
            reason: 'Asked by <b>jo.smith@defra.gov.uk</b>'
          })
        ])
      })

      const { result } = await get('/admin/audit')
      const $ = load(result)
      const action = $('[data-testid="audit-row"] td').eq(2)

      expect(action.text().replace(/\s+/g, ' ').trim()).toBe(
        'Revealed a credential Person affected: Jo Smith Reason: Asked by <b>jo.smith@defra.gov.uk</b>'
      )
      expect(result).not.toContain('<b>jo.smith')
    })

    test.each([
      ['platform-admin', 'Platform Admin'],
      ['team-admin', 'Team Admin'],
      ['team-member', 'Team member'],
      ['person', 'Person with no team role']
    ])('says the %s actor type as "%s"', async (type, text) => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([
          event({ actor: { type, displayName: 'Priya Raman' } })
        ])
      })

      const $ = load((await get('/admin/audit')).result)

      expect($('[data-testid="audit-row"] td').eq(1).text()).toContain(text)
    })

    test('says System for a system step, once, and Unknown person and "Team no longer exists" for what it cannot name', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([
          event({
            id: 's',
            action: 'teamDeployment.transition',
            actor: { type: 'system', displayName: null },
            subject: null
          }),
          event({
            id: 'u',
            actor: { type: 'team-member', displayName: null },
            subject: { displayName: null },
            team: { id: 'gone', name: null }
          })
        ])
      })

      const $ = load((await get('/admin/audit')).result)
      const rows = $('[data-testid="audit-row"]')

      expect(cells(rows[0], $)[1]).toBe('System')
      expect(cells(rows[1], $)[1]).toBe('Unknown person Team member')
      expect(cells(rows[1], $)[2]).toBe(
        'Added a member Person affected: Unknown person'
      )
      expect(cells(rows[1], $)[3]).toBe('Team no longer exists')
    })

    test('shows an action it has no words for as its code', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([event({ action: 'admin.team.archive' })])
      })

      const $ = load((await get('/admin/audit')).result)

      expect(
        $('[data-testid="audit-row"] td')
          .eq(2)
          .text()
          .replace(/\s+/g, ' ')
          .trim()
      ).toBe('admin.team.archive Person affected: Jo Smith')
    })

    test('says a credential disable, with its reason, in words, and offers the credential actions in the Action filter', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([
          event({
            action: 'admin.credentials.disable',
            subject: null,
            environment: 'infradev',
            reason: 'Suspected misuse'
          })
        ])
      })

      const $ = load((await get('/admin/audit')).result)

      expect(
        $('[data-testid="audit-row"] td')
          .eq(2)
          .text()
          .replace(/\s+/g, ' ')
          .trim()
      ).toBe('Disabled a team’s credentials Reason: Suspected misuse')
      expect(
        $('#action option')
          .map((_, option) => $(option).text())
          .get()
      ).toEqual(
        expect.arrayContaining([
          'Disabled a team’s credentials',
          'Enabled a team’s credentials',
          'Revoked a team’s credentials'
        ])
      )
    })

    test('shows nothing from an event beyond the fields it is given: no email, object ID or user ID', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([
          event({
            actorUserId: 'user-id-123',
            oid: '11111111-2222-4333-8444-555555555555',
            email: 'priya.raman@defra.gov.uk',
            resourceId: 'secret-resource-id'
          })
        ])
      })

      const { result } = await get('/admin/audit')

      expect(result).not.toContain('user-id-123')
      expect(result).not.toContain('11111111-2222')
      expect(result).not.toContain('priya.raman@defra.gov.uk')
      expect(result).not.toContain('secret-resource-id')
    })

    test('says one event in the singular', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing([event()]) })

      const $ = load((await get('/admin/audit')).result)

      expect($('[data-testid="audit-count"]').text()).toBe(
        'Showing 1 to 1 of 1 event. Events are kept for 30 days.'
      )
    })

    test('says how long events are kept from what the backend says', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: listing([event()], { retentionDays: 90 })
      })

      const $ = load((await get('/admin/audit')).result)

      expect($('[data-testid="audit-count"]').text()).toContain(
        'kept for 90 days'
      )
    })
  })

  describe('the filter form', () => {
    test('is a GET form named "Filter the audit log", with a label on every field and the dates in fieldsets', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const $ = load((await get('/admin/audit')).result)
      const form = $('form[aria-labelledby="filter-heading"]')

      expect(form.attr('method')).toBe('get')
      expect(form.attr('action')).toBe('/admin/audit')
      expect($('#filter-heading').text()).toBe('Filter the audit log')
      expect(
        ['team', 'environment', 'action', 'actorType', 'person'].map((id) =>
          $(`label[for="${id}"]`).text().trim()
        )
      ).toEqual(['Team', 'Environment', 'Action', 'Actor type', 'Person'])
      expect($('#person-hint').text().trim()).toBe('Part of a name')
      expect(
        $('fieldset legend')
          .map((_, legend) => $(legend).text().trim())
          .get()
      ).toEqual(['From date', 'To date'])
      expect(
        $('form[aria-labelledby="filter-heading"] input')
          .map((_, input) => $(input).attr('name'))
          .get()
      ).toEqual([
        'person',
        'from-day',
        'from-month',
        'from-year',
        'to-day',
        'to-month',
        'to-year'
      ])
      expect($('[data-testid="audit-apply"]').text().trim()).toBe(
        'Apply filters'
      )
      expect($('[data-testid="audit-clear"]')).toHaveLength(0)
    })

    test('offers the teams and environments the backend gave, the actions by plain label and the five actor types', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const $ = load((await get('/admin/audit')).result)
      const options = (id) =>
        $(`#${id} option`)
          .map((_, option) => `${$(option).attr('value')}|${$(option).text()}`)
          .get()

      expect(options('team')).toEqual([
        '|All teams',
        'team-1|Flood Risk Team',
        'team-2|Air Quality Team'
      ])
      expect(options('environment')).toEqual([
        '|All environments',
        'infradev|Development',
        'prod|Production'
      ])
      expect(options('actorType')).toEqual([
        '|All actor types',
        'platform-admin|Platform Admin',
        'team-admin|Team Admin',
        'team-member|Team member',
        'person|Person with no team role',
        'system|System'
      ])
      expect(options('action')[0]).toBe('|All actions')
      expect(options('action')).toContain('access.denied|Access refused')
      expect(options('action')).toContain('team.create|Created a team')
    })

    test('asks the backend for each filter, keeps them filled in and offers Clear filters', async () => {
      const from = encodeURIComponent('2026-03-29T00:00:00.000Z')
      const to = encodeURIComponent('2026-10-25T23:59:59.999Z')

      mockApi(fetchMock, {
        [`GET ${AUDIT}?team=team-1&environment=prod&person=Jo+Smith&action=team.create&actorType=team-admin&from=${from}&to=${to}`]:
          listing([event()], { total: 1 })
      })

      const $ = load(
        (
          await get(
            '/admin/audit?team=team-1&environment=prod&person=%20Jo%20Smith%20&action=team.create&actorType=team-admin&from-day=29&from-month=3&from-year=2026&to-day=25&to-month=10&to-year=2026&other=x'
          )
        ).result
      )

      expect(adminCalls()).toHaveLength(1)
      expect($('#team option:selected').attr('value')).toBe('team-1')
      expect($('#environment option:selected').attr('value')).toBe('prod')
      expect($('#action option:selected').attr('value')).toBe('team.create')
      expect($('#actorType option:selected').attr('value')).toBe('team-admin')
      expect($('#person').attr('value')).toBe('Jo Smith')
      expect($('#from-day').attr('value')).toBe('29')
      expect($('#from-month').attr('value')).toBe('3')
      expect($('#from-year').attr('value')).toBe('2026')
      expect($('#to-day').attr('value')).toBe('25')
      expect($('[data-testid="audit-clear"]').attr('href')).toBe('/admin/audit')
    })

    test('opens with a team selected when the link from the team says so', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}?team=team-2`]: listing([event()], { total: 1 })
      })

      const $ = load((await get('/admin/audit?team=team-2')).result)

      expect(adminCalls()).toEqual([`${AUDIT}?team=team-2`])
      expect($('#team option:selected').text()).toBe('Air Quality Team')
    })

    test('still shows a team, environment or action that is not on the lists, so the form says what was asked', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}?team=gone&environment=staging&action=odd.thing`]:
          listing([], { total: 0 })
      })

      const $ = load(
        (
          await get(
            '/admin/audit?team=gone&environment=staging&action=odd.thing'
          )
        ).result
      )

      expect($('#team option:selected').text()).toBe('Unknown team')
      expect($('#environment option:selected').text()).toBe('staging')
      expect($('#action option:selected').text()).toBe('odd.thing')
    })
  })

  describe('paging and the empty state', () => {
    test('pages through 30 events, 25 to a page, keeping the filters in the links', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}?person=Jo`]: listing(
          Array.from({ length: 25 }, (_, index) => event({ id: `e${index}` })),
          { total: 30 }
        )
      })

      const $ = load((await get('/admin/audit?person=Jo')).result)

      expect($('[data-testid="audit-row"]')).toHaveLength(25)
      expect($('[data-testid="audit-count"]').text()).toBe(
        'Showing 1 to 25 of 30 events. Events are kept for 30 days.'
      )
      expect($('.govuk-pagination__next a').attr('href')).toBe(
        '/admin/audit?person=Jo&page=2'
      )
      expect($('.govuk-pagination__prev')).toHaveLength(0)
    })

    test('asks for the page and shows where it is', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}?page=2`]: listing([event()], { page: 2, total: 26 })
      })

      const $ = load((await get('/admin/audit?page=2')).result)

      expect($('[data-testid="audit-count"]').text()).toContain(
        'Showing 26 to 26 of 26 events'
      )
      expect($('.govuk-pagination__prev a').attr('href')).toBe('/admin/audit')
    })

    test('has no pagination when one page holds every event', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const $ = load((await get('/admin/audit')).result)

      expect($('.govuk-pagination')).toHaveLength(0)
    })

    test('says no events match, how far back the log goes, and offers Clear filters', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}?person=zzz`]: listing([], { total: 0 })
      })

      const $ = load((await get('/admin/audit?person=zzz')).result)
      const empty = $('[data-testid="audit-empty"]')

      expect(empty.find('h2').text()).toBe('No events match')
      expect(empty.text()).toContain('The audit log goes back 30 days.')
      expect(empty.find('a').attr('href')).toBe('/admin/audit')
      expect($('[data-testid="audit-table"]')).toHaveLength(0)
      expect($('[data-testid="audit-count"]')).toHaveLength(0)
    })

    test('says there are no events yet when nothing is filtered and the log is empty', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing([], { total: 0 }) })

      const $ = load((await get('/admin/audit')).result)

      expect($('[data-testid="audit-empty"] h2').text()).toBe(
        'There are no events in the last 30 days'
      )
      expect($('[data-testid="audit-empty"] a')).toHaveLength(0)
    })

    test('says a page past the last does not exist, with no count and no table, and links to the first and last pages, keeping the filters', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}?person=Jo&page=9`]: listing([], { page: 9, total: 30 })
      })

      const $ = load((await get('/admin/audit?person=Jo&page=9')).result)
      const past = $('[data-testid="audit-past-end"]')

      expect(past.find('h2').text()).toBe('There is no page 9')
      expect(past.text()).toContain('There are 30 events on 2 pages.')
      expect(
        past
          .find('a')
          .map((_, link) => `${$(link).text()} ${$(link).attr('href')}`)
          .get()
      ).toEqual([
        'Go to page 1 /admin/audit?person=Jo',
        'Go to page 2 (the last page) /admin/audit?person=Jo&page=2'
      ])
      expect($('[data-testid="audit-count"]')).toHaveLength(0)
      expect($('[data-testid="audit-table"]')).toHaveLength(0)
      expect($('[data-testid="audit-empty"]')).toHaveLength(0)
      expect($('.govuk-pagination')).toHaveLength(0)
    })

    test('says there is one page to go to when 1 event is on 1 page and the page asked for is past it', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}?page=3`]: listing([], { page: 3, total: 1 })
      })

      const $ = load((await get('/admin/audit?page=3')).result)
      const past = $('[data-testid="audit-past-end"]')

      expect(past.text()).toContain('There is 1 event on 1 page.')
      expect(past.find('a')).toHaveLength(1)
      expect(past.find('a').attr('href')).toBe('/admin/audit')
    })
  })

  describe('when the filters are wrong', () => {
    function expectError($, { href, text }) {
      expect($('title').text()).toContain('Error: Audit log - Admin')
      expect($('.govuk-error-summary__title').text().trim()).toBe(
        'There is a problem'
      )
      expect($('.govuk-error-summary a').attr('href')).toBe(href)
      expect($('.govuk-error-summary a').text()).toBe(text)
      expect($('[data-testid="audit-table"]')).toHaveLength(0)
      expect($('[data-testid="audit-empty"]')).toHaveLength(0)
      expect($('[data-testid="audit-count"]')).toHaveLength(0)
    }

    test('refuses a person that is too short on the Person field, lists no events and keeps the form', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const { statusCode, result } = await get(
        '/admin/audit?person=a&team=team-1'
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expectError($, {
        href: '#person',
        text: 'Person must be 2 to 100 characters'
      })
      expect($('#person-error').text()).toContain(
        'Person must be 2 to 100 characters'
      )
      expect($('#person').attr('value')).toBe('a')
      expect($('#team option:selected').attr('value')).toBe('team-1')
      // The only call is the unfiltered one that fills the Team and
      // Environment lists: the bad filter is never sent.
      expect(adminCalls()).toEqual([AUDIT])
    })

    test('refuses a person that is too long', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const { statusCode, result } = await get(
        `/admin/audit?person=${'x'.repeat(101)}`
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(load(result)('.govuk-error-summary a').attr('href')).toBe(
        '#person'
      )
    })

    test.each([
      [
        'from-day=1',
        '#from-month',
        'From date must include a month and year',
        'from',
        'month'
      ],
      [
        'to-day=31&to-month=2&to-year=2026',
        '#to-day',
        'To date must be a real date',
        'to',
        'day'
      ],
      [
        'from-day=2&from-month=7&from-year=2026&to-day=1&to-month=7&to-year=2026',
        '#to-day',
        'To date must be the same as or after the From date',
        'to',
        'day'
      ]
    ])(
      'puts an error on the date input for %s, marks the parts and keeps what was typed',
      async (query, href, text, name, markedPart) => {
        mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

        const { statusCode, result } = await get(`/admin/audit?${query}`)
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expectError($, { href, text })
        expect($(`#${name}-error`).text()).toContain(text)
        expect($(`#${name}-${markedPart}`).attr('class')).toContain(
          'govuk-input--error'
        )
        expect(adminCalls()).toEqual([AUDIT])
        expect($(`#${name}-day`).attr('value')).toBe(
          new URLSearchParams(query).get(`${name}-day`)
        )
      }
    )

    test('marks only the missing part of an incomplete date', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const $ = load(
        (await get('/admin/audit?from-day=1&from-year=2026')).result
      )

      expect($('#from-day').attr('class')).not.toContain('govuk-input--error')
      expect($('#from-month').attr('class')).toContain('govuk-input--error')
      expect($('#from-year').attr('class')).not.toContain('govuk-input--error')
    })

    test('says the page number is wrong, not a field', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const { statusCode, result } = await get('/admin/audit?page=0')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('.govuk-error-summary a').text()).toContain(
        'The page number must be a whole number'
      )
      expect($('.govuk-error-summary a').attr('href')).toBe('#filter-heading')
      expect($('.govuk-error-message')).toHaveLength(0)
    })

    test('says so when the backend refuses a query this page let through', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}?team=bad`]: reply(400, {
          statusCode: 400,
          code: 'invalid-query',
          message: 'Bad query'
        }),
        [`GET ${AUDIT}`]: listing()
      })

      const { statusCode, result } = await get('/admin/audit?team=bad')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expectError($, {
        href: '#filter-heading',
        text: 'The filters could not be used. Clear the filters and try again'
      })
      expect($('#team option:selected').text()).toBe('Unknown team')
      // The link goes to the form's heading, which can take focus, not to a
      // field that is not at fault.
      expect($('#filter-heading').attr('tabindex')).toBe('-1')
      expect($('.govuk-error-message')).toHaveLength(0)
    })

    test('puts a team the backend would refuse as an error on the Team field, and asks nothing filtered', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: listing() })

      const { statusCode, result } = await get(
        `/admin/audit?team=${'x'.repeat(101)}`
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expectError($, { href: '#team', text: 'Choose a team from the list' })
      expect($('#team-error').text()).toContain('Choose a team from the list')
      expect(adminCalls()).toEqual([AUDIT])
    })

    test('shows the 403 page, not the form, when a person who is not a Platform Admin gives a bad filter', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: FORBIDDEN })

      const { statusCode, result } = await get('/admin/audit?person=a')

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(load(result)('h1').text()).toBe(
        'Only a Platform Admin can use this page'
      )
    })
  })

  describe('when the backend does not give the list', () => {
    test('shows the 403 page, titled as its heading, and takes the Admin link away, when the backend says the person is not a Platform Admin', async () => {
      mockApi(fetchMock, { [`GET ${AUDIT}`]: FORBIDDEN })

      const response = await get('/admin/audit')
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect($('h1').text()).toBe('Only a Platform Admin can use this page')
      expect($('title').text()).toContain(
        'Only a Platform Admin can use this page'
      )
      expect($('.govuk-button').attr('href')).toBe('/')

      mockApi(fetchMock, { 'GET /v1/models': { items: [] } })
      const next = load(
        (await get('/models', mergeCookies({ ...cookies }, response))).result
      )

      expect(
        next('.govuk-service-navigation__link')
          .map((_, link) => next(link).text().trim())
          .get()
      ).not.toContain('Admin')
    })

    test('still asks the backend when the session never said the person was a Platform Admin', async () => {
      const plain = await signInViaOidc(server, fetchMock)

      mockApi(fetchMock, { [`GET ${AUDIT}`]: FORBIDDEN })

      const { statusCode, result } = await get('/admin/audit', plain)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(adminCalls()).toEqual([AUDIT])
      expect(result).toContain('Only a Platform Admin can use this page')
    })

    test.each([
      ['the backend fails', reply(500, { code: 'internal', message: 'No' })],
      [
        'the backend cannot be reached',
        reply(502, { code: 'upstream-unavailable', message: 'No' })
      ]
    ])(
      'says it could not load the page, with Try again, when %s',
      async (_name, answer) => {
        mockApi(fetchMock, { [`GET ${AUDIT}?team=team-1`]: answer })

        const { statusCode, result } = await get('/admin/audit?team=team-1')
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badGateway)
        expect($('h1').text()).toBe('We could not load this page')
        expect($('main .govuk-button').attr('href')).toBe(
          '/admin/audit?team=team-1'
        )
      }
    )

    test('is an error page for a refusal it has no page for', async () => {
      mockApi(fetchMock, {
        [`GET ${AUDIT}`]: reply(418, { code: 'teapot', message: 'No' })
      })

      const { statusCode } = await get('/admin/audit')

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })
})

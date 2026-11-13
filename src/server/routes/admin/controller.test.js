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

const FORBIDDEN = reply(403, {
  statusCode: 403,
  error: 'Forbidden',
  message: 'Forbidden',
  code: 'platform-admin-required'
})

function listItem(overrides = {}) {
  return {
    id: 'team-1',
    name: 'Flood Risk Team',
    slug: 'flood-risk-team',
    status: 'active',
    environments: ['infradev'],
    memberCount: 3,
    ...overrides
  }
}

describe('#admin teams', () => {
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

  function navigation($) {
    return $('.govuk-service-navigation__link')
      .map((_, link) => $(link).text().trim())
      .get()
  }

  describe('GET /admin', () => {
    test('redirects a signed out person to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/admin'
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toContain('/sign-in')
    })

    test('sends a signed in person to the Teams tab', async () => {
      const { statusCode, headers } = await get('/admin')

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/admin/teams')
    })
  })

  describe('GET /admin/teams', () => {
    test('redirects a signed out person to sign in, and asks the backend nothing', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/admin/teams'
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toContain('/sign-in')
      expect(adminCalls()).toEqual([])
    })

    test('lists the teams with status, environments and members, in the Admin area', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams': {
          teams: [
            listItem(),
            listItem({
              id: 'team 2',
              name: 'Air <b>Quality</b>',
              status: 'pending-removal',
              environments: [],
              memberCount: 1
            })
          ],
          page: 1,
          pageSize: 25,
          total: 2
        }
      })

      const { statusCode, result } = await get('/admin/teams')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('title').text()).toContain('Teams - Admin')
      expect($('h1').text()).toBe('Teams')
      expect($('[data-testid="app-heading-caption"]').text()).toBe('Admin')
      expect(navigation($)).toContain('Admin')
      expect($('.govuk-service-navigation__item--active').text()).toContain(
        'Admin'
      )
      expect(
        $('[data-testid="sub-navigation"] [aria-current="page"]').text()
      ).toBe('Teams')
      expect($('[data-testid="teams-count"]').text()).toBe(
        'Showing 1 to 2 of 2 teams'
      )

      const rows = $('[data-testid="team-row"]')
        .map((_, row) =>
          $(row)
            .find('td')
            .map((__, cell) => $(cell).text().trim())
            .get()
        )
        .get()

      expect(rows).toEqual([
        'Flood Risk Team',
        'Active',
        'Development',
        '3',
        'Air <b>Quality</b>',
        'Pending removal',
        'None',
        '1'
      ])
      expect(
        $('[data-testid="team-row"] a')
          .map((_, link) => $(link).attr('href'))
          .get()
      ).toEqual(['/admin/teams/team-1', '/admin/teams/team%202'])
      expect(
        $('[data-testid="team-row"] .govuk-tag').first().attr('class')
      ).toContain('govuk-tag--green')
      expect(result).not.toContain('<b>Quality</b>')
    })

    test('has a table caption, column headers and a search form that is a GET', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams': {
          teams: [listItem()],
          page: 1,
          pageSize: 25,
          total: 1
        }
      })

      const $ = load((await get('/admin/teams')).result)

      expect($('form[role="search"]').attr('method')).toBe('get')
      expect($('form[role="search"]').attr('action')).toBe('/admin/teams')
      expect($('label[for="search"]').text().trim()).toBe('Search by team name')
      expect($('label[for="status"]').text().trim()).toBe('Status')
      expect(
        $('#status option')
          .map((_, option) => $(option).text())
          .get()
      ).toEqual(['All statuses', 'Active', 'Disabled', 'Pending removal'])
      expect($('caption').text()).toBe('Teams')
      expect($('.app-table-scroll').attr('aria-label')).toBe('Teams')
      expect($('.app-table-scroll').attr('tabindex')).toBe('0')
      expect(
        $('th')
          .map((_, header) => $(header).text().trim())
          .get()
      ).toEqual(['Team', 'Status', 'Environments', 'Members'])
      expect($('[data-testid="teams-clear"]')).toHaveLength(0)
    })

    test('asks the backend for the search, status and page only, and shows them again', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams?search=flood&status=disabled&page=2': {
          teams: [listItem({ status: 'disabled' })],
          page: 2,
          pageSize: 25,
          total: 26
        }
      })

      const { statusCode, result } = await get(
        '/admin/teams?search=%20flood%20&status=disabled&page=2&other=x'
      )
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(adminCalls()).toEqual([
        '/v1/admin/teams?search=flood&status=disabled&page=2'
      ])
      expect($('#search').attr('value')).toBe('flood')
      expect($('#status option:selected').attr('value')).toBe('disabled')
      expect($('[data-testid="teams-count"]').text()).toBe(
        'Showing 26 to 26 of 26 teams'
      )
      expect($('[data-testid="teams-clear"]').attr('href')).toBe('/admin/teams')
    })

    test('says it is the only team when there is one', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams': {
          teams: [listItem()],
          page: 1,
          pageSize: 25,
          total: 1
        }
      })

      const $ = load((await get('/admin/teams')).result)

      expect($('[data-testid="teams-count"]').text()).toBe(
        'Showing 1 to 1 of 1 team'
      )
    })

    test('pages through 30 teams, 25 to a page, keeping the filters in the links', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams?search=team': {
          teams: Array.from({ length: 25 }, (_, index) =>
            listItem({ id: `t${index}`, name: `Team ${index}` })
          ),
          page: 1,
          pageSize: 25,
          total: 30
        }
      })

      const $ = load((await get('/admin/teams?search=team')).result)

      expect($('[data-testid="team-row"]')).toHaveLength(25)
      expect($('[data-testid="teams-count"]').text()).toBe(
        'Showing 1 to 25 of 30 teams'
      )
      expect($('.govuk-pagination__next a').attr('href')).toBe(
        '/admin/teams?search=team&page=2'
      )
      expect($('.govuk-pagination__prev')).toHaveLength(0)
      expect(
        $('.govuk-pagination__link[aria-current="page"]').text().trim()
      ).toBe('1')
    })

    test('has no pagination when one page holds every team', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams': {
          teams: [listItem()],
          page: 1,
          pageSize: 25,
          total: 1
        }
      })

      const $ = load((await get('/admin/teams')).result)

      expect($('.govuk-pagination')).toHaveLength(0)
    })

    test('says no teams match, with Clear filters, when a search finds none', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams?search=zzz&status=active': {
          teams: [],
          page: 1,
          pageSize: 25,
          total: 0
        }
      })

      const $ = load(
        (await get('/admin/teams?search=zzz&status=active')).result
      )

      expect($('[data-testid="teams-empty"] h2').text()).toBe(
        'No teams match your search'
      )
      expect($('[data-testid="teams-empty"] a').attr('href')).toBe(
        '/admin/teams'
      )
      expect($('[data-testid="teams-table"]')).toHaveLength(0)
    })

    test('says there are no teams when there are none and nothing was asked for', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams': { teams: [], page: 1, pageSize: 25, total: 0 }
      })

      const $ = load((await get('/admin/teams')).result)

      expect($('[data-testid="teams-empty"] h2').text()).toBe(
        'There are no teams yet'
      )
    })

    test.each([
      [
        'search=a',
        '#search',
        'Search must be 2 to 100 characters',
        'a',
        'All statuses'
      ],
      [
        'search=flood&status=gone',
        '#status',
        'Choose a status from the list',
        'flood',
        'All statuses'
      ]
    ])(
      'shows the backend’s refusal of %s as an error on the field, keeping what was typed',
      async (query, href, text, search) => {
        mockApi(fetchMock, {
          [`GET /v1/admin/teams?${query}`]: reply(400, {
            statusCode: 400,
            code: 'invalid-query',
            message: 'Bad query'
          })
        })

        const { statusCode, result } = await get(`/admin/teams?${query}`)
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('title').text()).toContain('Error: Teams - Admin')
        expect($('.govuk-error-summary__title').text().trim()).toBe(
          'There is a problem'
        )
        expect($('.govuk-error-summary a').attr('href')).toBe(href)
        expect($('.govuk-error-summary a').text()).toBe(text)
        expect($('.govuk-error-message').text()).toContain(text)
        expect($('#search').attr('value')).toBe(search)
        expect($('[data-testid="teams-table"]')).toHaveLength(0)
        expect($('[data-testid="teams-empty"]')).toHaveLength(0)
      }
    )

    test.each([['page=0'], ['page=abc']])(
      'reports an invalid page number as a page error, not a search error (%s)',
      async (query) => {
        mockApi(fetchMock, {
          [`GET /v1/admin/teams?${query}`]: reply(400, {
            statusCode: 400,
            code: 'invalid-query',
            message: 'Bad query'
          })
        })

        const { statusCode, result } = await get(`/admin/teams?${query}`)
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badRequest)
        expect($('.govuk-error-summary a').text()).toContain(
          'The page number must be a whole number'
        )
        expect($('.govuk-error-summary').text()).not.toContain('Search must be')
        expect($('.govuk-error-message')).toHaveLength(0)
      }
    )

    test('shows the 403 page, and takes the Admin link away, when the backend says the person is not a Platform Admin', async () => {
      mockApi(fetchMock, { 'GET /v1/admin/teams': FORBIDDEN })

      const response = await get('/admin/teams')
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect($('h1').text()).toBe('Only a Platform Admin can use this page')
      expect($('title').text()).toContain(
        'Only a Platform Admin can use this page'
      )
      expect($('title').text()).not.toContain('Platform admins only')
      expect($('.govuk-button').attr('href')).toBe('/')

      mockApi(fetchMock, { 'GET /v1/models': { items: [] } })
      const next = load(
        (await get('/models', mergeCookies({ ...cookies }, response))).result
      )

      expect(navigation(next)).not.toContain('Admin')
    })

    test('still asks the backend when the session never said the person was a Platform Admin', async () => {
      const plain = await signInViaOidc(server, fetchMock)

      mockApi(fetchMock, { 'GET /v1/admin/teams': FORBIDDEN })

      const { statusCode, result } = await get('/admin/teams', plain)

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(adminCalls()).toEqual(['/v1/admin/teams'])
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
        mockApi(fetchMock, { 'GET /v1/admin/teams?search=flood': answer })

        const { statusCode, result } = await get('/admin/teams?search=flood')
        const $ = load(result)

        expect(statusCode).toBe(statusCodes.badGateway)
        expect($('h1').text()).toBe('We could not load this page')
        expect($('main .govuk-button').text().trim()).toBe('Try again')
        expect($('main .govuk-button').attr('href')).toBe(
          '/admin/teams?search=flood'
        )
      }
    )

    test('is an error page for a refusal it has no page for', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams': reply(418, { code: 'teapot', message: 'No' })
      })

      const { statusCode } = await get('/admin/teams')

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  describe('GET /admin/teams/{id}', () => {
    function detail(overrides = {}, members) {
      return {
        team: {
          id: 'team-1',
          name: 'Flood Risk Team',
          slug: 'flood-risk-team',
          serviceCode: 'FRM',
          status: 'active',
          environments: [{ environment: 'infradev', fileStatus: 'active' }],
          ...overrides
        },
        members: members ?? [
          {
            _id: 'member-1',
            userId: 'user-1',
            displayName: 'Test User',
            email: 'test.user@defra.gov.uk',
            role: 'admin',
            status: 'active'
          },
          {
            _id: 'member-2',
            userId: 'user-2',
            displayName: 'Priya Raman',
            email: 'priya.raman@defra.gov.uk',
            role: 'user',
            status: 'active'
          },
          {
            _id: 'member-3',
            userId: 'user-3',
            displayName: 'Gone Away',
            email: 'gone@defra.gov.uk',
            role: 'user',
            status: 'removed'
          }
        ]
      }
    }

    test('redirects a signed out person to sign in', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/admin/teams/team-1'
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toContain('/sign-in')
    })

    test('shows an active team: status, service code, environments and every member in full', async () => {
      mockApi(fetchMock, { 'GET /v1/admin/teams/team-1': detail() })

      const { statusCode, result } = await get('/admin/teams/team-1')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect(adminCalls()).toEqual(['/v1/admin/teams/team-1'])
      expect($('title').text()).toContain('Flood Risk Team - Admin')
      expect($('h1').text()).toBe('Flood Risk Team')
      expect($('[data-testid="app-heading-caption"]').text()).toBe('Team')
      expect(
        $('.govuk-breadcrumbs__list-item')
          .map((_, item) => $(item).text().trim())
          .get()
      ).toEqual(['Home', 'Admin', 'Teams', 'Flood Risk Team'])

      const summary = $('[data-testid="team-summary"] .govuk-summary-list__row')
        .map((_, row) => ({
          key: $(row).find('dt').text().trim(),
          value: $(row).find('dd').text().replace(/\s+/g, ' ').trim()
        }))
        .get()

      expect(summary).toEqual([
        { key: 'Status', value: 'Active' },
        { key: 'Service code', value: 'FRM' },
        { key: 'Environments', value: 'Development: Active' }
      ])
      expect(
        $('.govuk-summary-list .govuk-tag').first().attr('class')
      ).toContain('govuk-tag--green')

      expect(
        $('[data-testid="member-row"]')
          .map((_, row) =>
            $(row)
              .find('td')
              .map((__, cell) => $(cell).text().trim())
              .get()
          )
          .get()
      ).toEqual([
        'Test User (you)',
        'test.user@defra.gov.uk',
        'Admin',
        'Remove Test User (you) from Flood Risk Team',
        'Priya Raman',
        'priya.raman@defra.gov.uk',
        'Member',
        'Remove Priya Raman from Flood Risk Team'
      ])
      expect(
        $('[data-testid="member-remove"]')
          .map((_, link) => $(link).attr('href'))
          .get()
      ).toEqual([
        '/admin/teams/team-1/members/member-1/remove',
        '/admin/teams/team-1/members/member-2/remove'
      ])
      expect($('[data-testid="add-member"]').attr('href')).toBe(
        '/admin/teams/team-1/members/add'
      )
    })

    test('links to the audit log of the team, with the team set, and has the Audit log tab', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams/team%201': detail({ id: 'team 1' })
      })

      const $ = load((await get('/admin/teams/team%201')).result)

      expect($('[data-testid="view-audit-log"]').text()).toBe('View audit log')
      expect($('[data-testid="view-audit-log"]').attr('href')).toBe(
        '/admin/audit?team=team%201'
      )
      expect(
        $('[data-testid="sub-navigation"] a')
          .map((_, link) => $(link).text().trim())
          .get()
      ).toEqual(['Teams', 'Deployments', 'Audit log'])
    })
    test.each([
      ['disabled', 'Disabled', 'govuk-tag--grey'],
      ['pending-removal', 'Pending removal', 'govuk-tag--orange'],
      [undefined, 'Active', 'govuk-tag--green']
    ])(
      'shows a %s team’s status as a tag, and no action to change it',
      async (status, text, classes) => {
        mockApi(fetchMock, {
          'GET /v1/admin/teams/team-1': detail({ status })
        })

        const $ = load((await get('/admin/teams/team-1')).result)
        const $tag = $('[data-testid="team-summary"] .govuk-tag').first()

        expect($tag.text().trim()).toBe(text)
        expect($tag.attr('class')).toContain(classes)
        expect($('main button')).toHaveLength(0)
        expect($('main form')).toHaveLength(0)
      }
    )

    test('shows each environment’s file status, and the date a pending removal may happen', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams/team-1': detail({
          status: 'pending-removal',
          environments: [
            {
              environment: 'infradev',
              fileStatus: 'pending-removal',
              removeAfter: '2026-11-26'
            },
            { environment: 'prod', fileStatus: 'removed' }
          ]
        })
      })

      const $ = load((await get('/admin/teams/team-1')).result)
      const environments = $('[data-testid="team-environments"] li')
        .map((_, item) => $(item).text().replace(/\s+/g, ' ').trim())
        .get()

      expect(environments).toEqual([
        'Development: Pending removal Can be removed from 26 November 2026',
        'Production: Removed'
      ])
    })

    test('links each environment the team is still in to its deployment, and not one that was removed', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams/team%201': detail({
          id: 'team 1',
          environments: [
            { environment: 'infradev', fileStatus: 'active' },
            { environment: 'prod', fileStatus: 'removed' }
          ]
        })
      })

      const $ = load((await get('/admin/teams/team%201')).result)
      const items = $('[data-testid="team-environments"] li')

      expect(items.eq(0).find('a').attr('href')).toBe(
        '/admin/deployments/team%201/infradev'
      )
      expect(items.eq(0).find('a').text()).toBe('Development')
      expect(items.eq(1).find('a')).toHaveLength(0)
    })

    test('says None for a team in no environment, and Not set for no service code', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams/team-1': detail({
          serviceCode: undefined,
          environments: []
        })
      })

      const $ = load((await get('/admin/teams/team-1')).result)
      const values = $('[data-testid="team-summary"] dd')
        .map((_, value) => $(value).text().replace(/\s+/g, ' ').trim())
        .get()

      expect(values).toEqual(['Active', 'Not set', 'None'])
    })

    test('shows the team not found page for a team the backend does not have', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams/nope': reply(404, {
          code: 'team-not-found',
          message: 'No'
        })
      })

      const { statusCode, result } = await get('/admin/teams/nope')
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.notFound)
      expect($('h1').text()).toBe('Team not found')
      expect($('.govuk-button').attr('href')).toBe('/admin/teams')
    })

    test('shows the 403 page when the backend refuses the person', async () => {
      mockApi(fetchMock, { 'GET /v1/admin/teams/team-1': FORBIDDEN })

      const { statusCode, result } = await get('/admin/teams/team-1')

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(result).toContain('Only a Platform Admin can use this page')
      expect(result).not.toContain('Flood Risk Team')
    })

    test('says it could not load the page when the backend fails', async () => {
      mockApi(fetchMock, {
        'GET /v1/admin/teams/team-1': reply(500, { code: 'internal' })
      })

      const { statusCode, result } = await get('/admin/teams/team-1')

      expect(statusCode).toBe(statusCodes.badGateway)
      expect(result).toContain('We could not load this page')
    })

    test('only reads: it writes nothing', async () => {
      mockApi(fetchMock, { 'GET /v1/admin/teams/team-1': detail() })

      await get('/admin/teams/team-1')

      expect(
        fetchMock.mock.calls.filter(
          ([url, options]) =>
            url.includes('/v1/admin') &&
            options?.method &&
            options.method !== 'GET'
        )
      ).toHaveLength(0)
    })
  })
})

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
const DETAILS_URL = `${TEAM_URL}/details`
const SERVICE_CODE_URL = `${DETAILS_URL}/service-code`
const DESCRIPTION_URL = `${DETAILS_URL}/description`
const NOT_FOUND = reply(404, { code: 'not-found', message: 'Not Found' })
const FORBIDDEN = reply(403, { code: 'forbidden', message: 'Forbidden' })

const team = {
  ...sampleTeam,
  serviceCode: 'FRM',
  description: 'Models for flood risk checks',
  verified: false
}

describe('#details', () => {
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

  // The signed-in person is an admin or a member of the team; or (no role)
  // has only their own keys, so the backend answers not found.
  function backend(role, { team: shown = team, ...extra } = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: role
        ? {
            team: shown,
            members: [
              {
                _id: 'member-1',
                userId: 'user-1',
                displayName: 'Test User',
                email: 'test.user@defra.gov.uk',
                role,
                status: 'active'
              }
            ],
            environments: []
          }
        : NOT_FOUND,
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

  function writes() {
    return fetchMock.mock.calls.filter(
      ([url, options]) =>
        url.includes('/v1/teams') && options?.method && options.method !== 'GET'
    )
  }

  function rows($) {
    return $('.govuk-summary-list__row')
      .map((_, row) => ({
        key: $(row).find('dt').text().trim(),
        value: $(row)
          .find('dd.govuk-summary-list__value')
          .text()
          .replaceAll(/\s+/g, ' ')
          .trim(),
        change: $(row).find('.govuk-summary-list__actions a').attr('href')
      }))
      .get()
  }

  describe('the Details tab', () => {
    test('GET /teams/{slug}/details redirects to /sign-in when signed out', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: DETAILS_URL
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toBe(
        `/sign-in?returnTo=${encodeURIComponent(DETAILS_URL)}`
      )
    })

    test('for a person with only their own keys: is not found, and does not say whether the team exists', async () => {
      backend(null)

      const { statusCode, result } = await get(DETAILS_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Team not found')
      expect(result).not.toContain('Flood Risk Team')
      expect(result).not.toContain('FRM')
    })

    test('for a member: shows the details with no way to change them', async () => {
      backend('user')

      const { statusCode, result } = await get(DETAILS_URL)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="app-heading-caption"]').text()).toBe('Team')
      expect($('h1').text()).toBe('Flood Risk Team')
      expect(
        $('[data-testid="sub-navigation"] [aria-current="page"]').text()
      ).toBe('Details')
      expect(rows($)).toEqual([
        { key: 'Team name', value: 'Flood Risk Team', change: undefined },
        {
          key: 'Team ID',
          value:
            'flood-risk-team Part of your team’s address on the gateway. It cannot change.',
          change: undefined
        },
        {
          key: 'Service code',
          value: 'FRM Not checked yet',
          change: undefined
        },
        {
          key: 'What the team does',
          value: 'Models for flood risk checks',
          change: undefined
        }
      ])
      expect(result).not.toContain('Change')
    })

    test('for an admin: offers to change the service code and what the team does, not the name or ID', async () => {
      backend('admin')

      const { result } = await get(DETAILS_URL)
      const $ = load(result)

      expect(rows($).map(({ key, change }) => [key, change])).toEqual([
        ['Team name', undefined],
        ['Team ID', undefined],
        ['Service code', SERVICE_CODE_URL],
        ['What the team does', DESCRIPTION_URL]
      ])
      expect($('[data-testid="change-service-code"]').text()).toBe(
        'Change the service code'
      )
    })

    test('says nothing about checking a service code that has been checked, and says when no description was given', async () => {
      backend('admin', {
        team: { ...team, verified: true, description: undefined }
      })

      const { result } = await get(DETAILS_URL)
      const $ = load(result)

      expect(result).not.toContain('Not checked yet')
      expect(rows($)[2].value).toBe('FRM')
      expect(rows($)[3].value).toBe('Not given')
    })

    test('shows a banner for a change just made, once', async () => {
      backend('admin', { [`PATCH ${TEAM_PATH}`]: { team } })

      const saved = await post(SERVICE_CODE_URL, { serviceCode: 'xyz' })
      const jar = mergeCookies({ ...cookies }, saved)
      const first = await get(DETAILS_URL, jar)

      expect(
        load(first.result)('[data-testid="team-notification"]').text()
      ).toContain('Service code updated.')

      const second = await get(DETAILS_URL, mergeCookies({ ...jar }, first))

      expect(second.result).not.toContain('Service code updated.')
    })
  })

  describe.each([
    {
      name: 'the service code',
      url: SERVICE_CODE_URL,
      field: 'serviceCode',
      heading: 'Change the service code',
      current: 'FRM',
      valid: ' xyz ',
      sent: 'xyz',
      invalid: 'TOO-LONG',
      message: 'Service code must be 3 letters or numbers, for example FRM',
      banner: 'Service code updated.'
    },
    {
      name: 'what the team does',
      url: DESCRIPTION_URL,
      field: 'description',
      heading: 'Change what the team does',
      current: 'Models for flood risk checks',
      valid: ' Flood and coastal models ',
      sent: 'Flood and coastal models',
      invalid: 'x'.repeat(501),
      message: 'What the team does must be 500 characters or fewer',
      banner: 'What the team does has been updated.'
    }
  ])('changing $name', (change) => {
    test('redirects to /sign-in when signed out', async () => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: change.url
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toContain('/sign-in')
    })

    test('a signed-out invalid submission is sent to sign in, without reading the team', async () => {
      backend('admin')

      const { statusCode, headers } = await server.inject({
        method: 'POST',
        url: change.url,
        headers: { cookie: cookieHeader({ crumb: cookies.crumb }) },
        payload: { crumb: cookies.crumb, [change.field]: change.invalid }
      })

      expect(statusCode).toBe(302)
      expect(headers.location).toBe(
        `/sign-in?returnTo=${encodeURIComponent(change.url)}`
      )
      expect(
        fetchMock.mock.calls.filter(([target]) => target.includes('/v1/teams'))
      ).toHaveLength(0)
    })

    test('for a person with only their own keys: is not found, and saves nothing', async () => {
      backend(null)

      const page = await get(change.url)

      backend(null)

      const save = await post(change.url, { [change.field]: change.valid })

      expect(page.statusCode).toBe(statusCodes.notFound)
      expect(save.statusCode).toBe(statusCodes.notFound)
      expect(writes()).toHaveLength(0)
    })

    test('for a member: says only an admin can, and saves nothing', async () => {
      backend('user')

      const page = await get(change.url)

      backend('user')

      const save = await post(change.url, { [change.field]: change.valid })

      expect(page.statusCode).toBe(statusCodes.forbidden)
      expect(page.result).toContain('Only a team admin can do that')
      expect(load(page.result)('.govuk-button').attr('href')).toBe(DETAILS_URL)
      expect(save.statusCode).toBe(statusCodes.forbidden)
      expect(writes()).toHaveLength(0)
    })

    test('for an admin: shows the current value with a back link to the details', async () => {
      backend('admin')

      const { statusCode, result } = await get(change.url)
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text().trim()).toBe(change.heading)
      expect($('[data-testid="app-heading-caption"]').text()).toBe(
        'Flood Risk Team'
      )
      expect($('.govuk-back-link').attr('href')).toBe(DETAILS_URL)
      expect($(`#${change.field}`).val()).toBe(change.current)
    })

    test('for an admin: saves the trimmed value, then returns to the details with a banner', async () => {
      backend('admin', {
        [`PATCH ${TEAM_PATH}`]: { team }
      })

      const saved = await post(change.url, { [change.field]: change.valid })

      expect(saved.statusCode).toBe(statusCodes.seeOther)
      expect(saved.headers.location).toBe(DETAILS_URL)

      const [url, options] = writes().at(-1)

      expect(url).toContain(TEAM_PATH)
      expect(options.method).toBe('PATCH')
      expect(JSON.parse(options.body)).toEqual({ [change.field]: change.sent })

      backend('admin')

      const details = await get(
        DETAILS_URL,
        mergeCookies({ ...cookies }, saved)
      )

      expect(
        load(details.result)('[data-testid="team-notification"]').text()
      ).toContain(change.banner)
    })

    test('for an admin: shows the error, and keeps what was typed, when the value is not valid', async () => {
      backend('admin')

      const { statusCode, result } = await post(change.url, {
        [change.field]: change.invalid
      })
      const $ = load(result)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect($('.govuk-error-summary').text()).toContain(change.message)
      expect($(`#${change.field}-error`).text()).toContain(change.message)
      expect($(`#${change.field}`).val()).toBe(change.invalid)
      expect($('title').text()).toContain(`Error: ${change.heading}`)
      expect(writes()).toHaveLength(0)
    })

    test('says only an admin can when the backend refuses the change', async () => {
      backend('admin', { [`PATCH ${TEAM_PATH}`]: FORBIDDEN })

      const { statusCode, result } = await post(change.url, {
        [change.field]: change.valid
      })

      expect(statusCode).toBe(statusCodes.forbidden)
      expect(result).toContain('Only a team admin can do that')
    })

    test('says the team is not found when the backend no longer has it', async () => {
      backend('admin', { [`PATCH ${TEAM_PATH}`]: NOT_FOUND })

      const { statusCode, result } = await post(change.url, {
        [change.field]: change.valid
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Team not found')
    })

    test('does not hide a backend fault reading the team', async () => {
      mockApi(fetchMock, {
        [`GET ${TEAM_PATH}`]: reply(500, { code: 'boom', message: 'Boom' })
      })

      const page = await get(change.url)

      expect(page.statusCode).toBe(statusCodes.internalServerError)
    })

    test('does not hide a backend fault', async () => {
      backend('admin', {
        [`PATCH ${TEAM_PATH}`]: reply(500, { code: 'boom', message: 'Boom' })
      })

      const { statusCode } = await post(change.url, {
        [change.field]: change.valid
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  test('a description can be cleared', async () => {
    backend('admin', { [`PATCH ${TEAM_PATH}`]: { team } })

    const saved = await post(DESCRIPTION_URL, { description: '' })

    expect(saved.statusCode).toBe(statusCodes.seeOther)
    expect(JSON.parse(writes().at(-1)[1].body)).toEqual({ description: '' })
  })
})

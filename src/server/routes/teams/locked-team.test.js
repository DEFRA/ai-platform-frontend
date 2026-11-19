import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  INFRADEV_URL,
  detail,
  operationsAnswer
} from '#/test-helpers/environments-helpers.js'
import {
  cookieHeader,
  mergeCookies,
  signInViaOidc
} from '#/test-helpers/oidc-session-helpers.js'
import {
  MEMBERS_URL,
  TEAM_PATH,
  TEAM_URL,
  priya,
  tom,
  you
} from '#/test-helpers/members-test-helpers.js'
import { sampleModel, sampleTeam } from '#/test-helpers/team-connect-helpers.js'

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

const CANNOT_CHANGE = 'You cannot change this team'
const TEAM_DISABLED = reply(409, {
  statusCode: 409,
  code: 'team-disabled',
  message: 'This team is disabled. You can view it but not change it.'
})
const CREDENTIAL_PATH = '/v1/credentials/cred-1'
const SECRET_URL = `${TEAM_URL}/client-secrets/cred-1`
const REMOVE_MODEL_URL = `${TEAM_URL}/models/deployment-1/remove`
const DEPLOYMENT_PATH = `${TEAM_PATH}/deployments/deployment-1`

const credential = {
  _id: 'cred-1',
  tier: 'team',
  teamId: 'team-1',
  environment: 'infradev',
  status: 'active',
  keyHint: 'ab12',
  allowedDeployments: ['gpt-4o'],
  expiresAt: null
}

function teamRead(team, role = 'admin') {
  return {
    team: { ...sampleTeam, ...team },
    members: [you(role), priya(), tom],
    environments: []
  }
}

// The team as the backend reads it: active, disabled with no environment
// ticked, or disabled with Infradev ticked.
const ACTIVE = teamRead({ status: 'active' })
const DISABLED = teamRead({ status: 'disabled', disabledEnvironments: [] })
const INFRADEV_DISABLED = teamRead({
  status: 'disabled',
  disabledEnvironments: ['infradev']
})
const INFRADEV_ONLY = teamRead({
  status: 'active',
  disabledEnvironments: ['infradev']
})

describe('#teams of a disabled team', () => {
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

  function backend(read, routes = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: read,
      'GET /v1/teams': { items: [] },
      'GET /v1/models': { items: [sampleModel] },
      [`GET ${TEAM_PATH}/environments`]: {
        team: { id: 'team-1', slug: sampleTeam.slug, name: sampleTeam.name },
        environments: []
      },
      [`GET ${DEPLOYMENT_PATH}`]: {
        deployment: {
          _id: 'deployment-1',
          teamId: 'team-1',
          modelSlug: 'gpt-4o',
          environment: 'infradev',
          status: 'active'
        }
      },
      'GET /v1/models/gpt-4o': sampleModel,
      [`GET ${CREDENTIAL_PATH}`]: credential,
      ...routes
    })
  }

  function get(url) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
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
      ([url, init]) =>
        url.includes('/v1/') &&
        !url.includes('/v1/users/me') &&
        init?.method &&
        init.method !== 'GET'
    )
  }

  function text($, selector) {
    return $(selector).text().replace(/\s+/g, ' ').trim()
  }

  function expectCannotChange(response, backHref) {
    const $ = load(response.result)

    expect(response.statusCode).toBe(statusCodes.conflict)
    expect(text($, 'h1')).toBe(CANNOT_CHANGE)
    expect($('title').text()).toContain(CANNOT_CHANGE)
    expect(text($, 'main')).toMatch(
      /You can view it but not change (it|its details or members)\./
    )
    expect(
      $(backHref ? `main a[href="${backHref}"]` : 'main a')
    ).not.toHaveLength(0)
    expect(response.result).not.toMatch(/reason/i)
  }

  describe('the team’s pages', () => {
    test.each([
      ['the Overview tab', TEAM_URL],
      ['the Members tab', MEMBERS_URL],
      ['the Details tab', `${TEAM_URL}/details`]
    ])(
      'shows %s Disabled with a banner that says it can be viewed and not changed, and nothing of why',
      async (_name, url) => {
        backend(DISABLED)

        const response = await get(url)
        const $ = load(response.result)

        expect(response.statusCode).toBe(statusCodes.ok)
        expect(text($, '[data-testid="team-status"]')).toBe('Status: Disabled')
        expect(text($, '[data-testid="team-lock-banner"]')).toContain(
          'This team is disabled'
        )
        expect(text($, '[data-testid="team-lock-banner"]')).toContain(
          'You can view it but you cannot change its details or members.'
        )
        expect(text($, '[data-testid="team-lock-banner"]')).not.toMatch(
          /reason|platform|admin|@/i
        )
      }
    )

    test('shows no banner and no status for a team that is not disabled, and offers every change', async () => {
      backend(ACTIVE)

      const members = load((await get(MEMBERS_URL)).result)
      const details = load((await get(`${TEAM_URL}/details`)).result)

      expect(members('[data-testid="team-lock-banner"]')).toHaveLength(0)
      expect(members('[data-testid="team-status"]')).toHaveLength(0)
      expect(members('a[data-testid="add-member"]').attr('href')).toBe(
        `${MEMBERS_URL}/add`
      )
      expect(members('a[data-testid="member-change"]')).toHaveLength(3)
      expect(details('a[data-testid="change-service-code"]')).toHaveLength(1)
      expect(details('a[data-testid="change-description"]')).toHaveLength(1)
    })

    test('greys Add a member as a disabled button and Change as plain text on the Members tab, even with no environment ticked', async () => {
      backend(DISABLED)

      const $ = load((await get(MEMBERS_URL)).result)
      const add = $('[data-testid="add-member"]')

      expect(add.is('button')).toBe(true)
      expect(add.attr('disabled')).toBeDefined()
      expect(add.attr('aria-disabled')).toBe('true')
      expect(add.attr('href')).toBeUndefined()
      expect($('a[data-testid="member-change"]')).toHaveLength(0)
      expect($('[data-testid="member-change-locked"]')).toHaveLength(3)
      expect(text($, '[data-testid="member-change-locked"]')).toContain(
        'Change role of Test User (you)'
      )
    })

    test('shows the service code and description as text, not links, on the Details tab', async () => {
      backend(DISABLED)

      const $ = load((await get(`${TEAM_URL}/details`)).result)

      expect($('a[data-testid="change-service-code"]')).toHaveLength(0)
      expect($('a[data-testid="change-description"]')).toHaveLength(0)
      expect(text($, '[data-testid="change-service-code-locked"]')).toBe(
        'Change the service code'
      )
      expect(text($, '[data-testid="change-description-locked"]')).toBe(
        'Change what the team does'
      )
    })

    test('shows a member no change to grey, only the banner', async () => {
      backend(teamRead({ status: 'disabled' }, 'user'))

      const $ = load((await get(MEMBERS_URL)).result)

      expect($('[data-testid="team-lock-banner"]')).toHaveLength(1)
      expect($('[data-testid="add-member"]')).toHaveLength(0)
      expect($('[data-testid="member-change-locked"]')).toHaveLength(0)
    })

    test('gives the lock banner and the notification of a change just made each their own title, so no id is used twice and each names itself', async () => {
      backend(ACTIVE, { [`DELETE ${TEAM_PATH}/members/member-3`]: reply(204) })

      const removed = await post(`${MEMBERS_URL}/member-3/remove`)
      const jar = mergeCookies({ ...cookies }, removed)

      backend(DISABLED)

      const $ = load(
        (
          await server.inject({
            method: 'GET',
            url: MEMBERS_URL,
            headers: { cookie: cookieHeader(jar) }
          })
        ).result
      )
      const ids = $('[id]')
        .map((_, element) => $(element).attr('id'))
        .get()
      const notification = $('[data-testid="team-notification"]')
      const lock = $('[data-testid="team-lock-banner"]')

      expect(notification).toHaveLength(1)
      expect(lock).toHaveLength(1)
      expect(new Set(ids).size).toBe(ids.length)

      for (const banner of [notification, lock]) {
        const titleId = banner.attr('aria-labelledby')

        expect(banner.find(`#${titleId}`)).toHaveLength(1)
      }

      expect(lock.attr('aria-labelledby')).not.toBe(
        notification.attr('aria-labelledby')
      )
    })
  })

  describe('a team-wide change, asked for a page of its own', () => {
    test.each([
      ['add a member', `${MEMBERS_URL}/add`],
      ['change a role', `${MEMBERS_URL}/me/role`],
      ['remove a member', `${MEMBERS_URL}/member-3/remove`]
    ])(
      'shows %s as the 409 page, with a link back to the members',
      async (_name, url) => {
        backend(DISABLED)

        expectCannotChange(await get(url), MEMBERS_URL)
      }
    )

    test.each([
      ['the service code', `${TEAM_URL}/details/service-code`],
      ['what the team does', `${TEAM_URL}/details/description`]
    ])(
      'shows changing %s as the 409 page, with a link back to the details',
      async (_name, url) => {
        backend(DISABLED)

        expectCannotChange(await get(url), `${TEAM_URL}/details`)
      }
    )

    test.each([
      [
        'adding a member',
        `${MEMBERS_URL}/add`,
        { action: 'search', search: 'pri' }
      ],
      ['changing a role', `${MEMBERS_URL}/member-3/role`, { role: 'admin' }],
      ['removing a member', `${MEMBERS_URL}/member-3/remove`, {}],
      [
        'changing the service code',
        `${TEAM_URL}/details/service-code`,
        { serviceCode: 'ABC' }
      ]
    ])(
      'refuses %s posted, and changes nothing',
      async (_name, url, payload) => {
        backend(DISABLED)

        expectCannotChange(await post(url, payload))
        expect(writes()).toEqual([])
      }
    )

    test('is still the not-an-admin page for a member, ahead of the lock', async () => {
      backend(teamRead({ status: 'disabled' }, 'user'))

      const { statusCode } = await get(`${MEMBERS_URL}/add`)

      expect(statusCode).toBe(statusCodes.forbidden)
    })

    test('does not lock a team that is active, even with an environment disabled', async () => {
      backend(INFRADEV_ONLY)

      expect((await get(`${MEMBERS_URL}/add`)).statusCode).toBe(statusCodes.ok)
      expect((await get(`${TEAM_URL}/details/description`)).statusCode).toBe(
        statusCodes.ok
      )
    })
  })

  describe('a change the backend refuses with team-disabled though the page offered it', () => {
    test.each([
      [
        'changing the service code',
        'PATCH',
        `${TEAM_PATH}`,
        `${TEAM_URL}/details/service-code`,
        { serviceCode: 'ABC' }
      ],
      [
        'changing a role',
        'PATCH',
        `${TEAM_PATH}/members/member-3`,
        `${MEMBERS_URL}/member-3/role`,
        { role: 'admin' }
      ],
      [
        'removing a member',
        'DELETE',
        `${TEAM_PATH}/members/member-3`,
        `${MEMBERS_URL}/member-3/remove`,
        {}
      ],
      ['removing a model', 'DELETE', DEPLOYMENT_PATH, REMOVE_MODEL_URL, {}],
      [
        'rotating a client secret',
        'POST',
        `${CREDENTIAL_PATH}/rotate`,
        `${SECRET_URL}/rotate`,
        {}
      ],
      [
        'viewing a client secret',
        'POST',
        `${CREDENTIAL_PATH}/reveal`,
        `${SECRET_URL}/view`,
        { reason: 'Debugging a failed call' }
      ]
    ])(
      'shows %s as the 409 page',
      async (_name, method, path, url, payload) => {
        backend(ACTIVE, { [`${method} ${path}`]: TEAM_DISABLED })

        const response = await post(url, payload)
        const $ = load(response.result)

        expect(response.statusCode).toBe(statusCodes.conflict)
        expect(text($, 'h1')).toBe(CANNOT_CHANGE)
        expect($('main a[href^="/teams/flood-risk-team"]')).toHaveLength(1)
      }
    )
  })

  describe('an environment action, in a disabled environment only', () => {
    test('shows removing a model in a disabled environment as the 409 page, with a link back to the environment', async () => {
      backend(INFRADEV_DISABLED)

      expectCannotChange(await get(REMOVE_MODEL_URL), INFRADEV_URL)
    })

    test('says the environment, not the team, when only the environment is disabled', async () => {
      backend(INFRADEV_ONLY)

      const response = await get(REMOVE_MODEL_URL)

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text(load(response.result), 'main')).toContain(
        'This environment is disabled. You can view it but not change it.'
      )
    })

    test('still removes a model in an environment the admin did not tick, though the team is disabled', async () => {
      backend(DISABLED)

      const response = await get(REMOVE_MODEL_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text(load(response.result), 'h1')).toBe(
        'Remove GPT-4o from Development?'
      )
    })

    test.each([
      ['viewing', `${SECRET_URL}/view`],
      ['rotating', `${SECRET_URL}/rotate`]
    ])(
      'shows %s the client secret in a disabled environment as the 409 page',
      async (_name, url) => {
        backend(INFRADEV_DISABLED)

        expectCannotChange(await get(url), INFRADEV_URL)
      }
    )

    test('keeps revoking the client secret open in a disabled environment', async () => {
      backend(INFRADEV_DISABLED)

      const response = await get(`${SECRET_URL}/revoke`)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text(load(response.result), 'h1')).toContain(
        'Are you sure you want to revoke the Flood Risk Team client secret?'
      )
    })

    test('lets a revoke through to the backend in a disabled environment', async () => {
      backend(INFRADEV_DISABLED, {
        [`DELETE ${CREDENTIAL_PATH}`]: { revoked: true }
      })

      const response = await post(`${SECRET_URL}/revoke`, {
        confirmRevoke: 'yes'
      })

      expect(response.statusCode).toBe(statusCodes.seeOther)
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url.includes(CREDENTIAL_PATH) && init.method === 'DELETE'
        )
      ).toBe(true)
    })
  })

  test('an environment page of the team stays readable (a sanity check of the fixtures)', async () => {
    backend(INFRADEV_DISABLED, {
      [`GET ${TEAM_PATH}/environments/infradev`]: detail(),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      [`GET ${TEAM_PATH}/status-changes`]: { items: [] },
      'GET /v1/credentials': { items: [credential] }
    })

    expect((await get(INFRADEV_URL)).statusCode).toBe(statusCodes.ok)
  })
})

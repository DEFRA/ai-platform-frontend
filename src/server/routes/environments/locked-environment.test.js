import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  FEDERATE_URL,
  FEDERATIONS_PATH,
  dryRun
} from '#/test-helpers/federation-helpers.js'
import {
  INFRADEV_URL,
  OVERVIEW_URL,
  TEAM_PATH,
  applicationsOf,
  clientSecretItem,
  clientSecretsOf,
  detail,
  doneOperation,
  environmentsRead,
  federatedApplication,
  operationsAnswer,
  summary
} from '#/test-helpers/environments-helpers.js'
import {
  cookieHeader,
  mergeCookies,
  signInViaOidc
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

const CANNOT_CHANGE = 'You cannot change this team'
const TEAM_DISABLED = reply(409, {
  statusCode: 409,
  code: 'team-disabled',
  message: 'This team is disabled. You can view it but not change it.'
})
const LIMITS_URL = `${INFRADEV_URL}/limits`
const QA_SET_UP_URL = `${OVERVIEW_URL}/qa/set-up`
const TOP_ACTIONS = '[data-testid="page-actions"]'

function teamRead(team, role = 'admin') {
  return teamWithMembers(role, { ...sampleTeam, ...team })
}

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

function text(scope, selector) {
  const matches =
    typeof scope === 'function' ? scope(selector) : scope.find(selector)

  return matches.text().replace(/\s+/g, ' ').trim()
}

describe('#environments of a disabled team', () => {
  let server
  let cookies
  const configured = config.get('teamEnvironments')

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('teamEnvironments', configured)
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    fetchMock.resetMocks()
    config.set('teamEnvironments', ['infradev', 'qa'])
    cookies = await signInViaOidc(server, fetchMock)
  })

  function backend(read, routes = {}) {
    mockApi(fetchMock, {
      'GET /v1/teams': { items: [sampleTeam] },
      'GET /v1/models': { items: [sampleModel] },
      [`GET ${TEAM_PATH}`]: read,
      [`GET ${TEAM_PATH}/environments`]: environmentsRead(),
      [`GET ${TEAM_PATH}/environments/infradev`]: detail(),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      [`GET ${TEAM_PATH}/status-changes`]: { items: [] },
      [`POST ${FEDERATIONS_PATH}/check`]: dryRun(),
      ...routes
    })
  }

  async function get(url) {
    const response = await server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
    })

    cookies = mergeCookies(cookies, response)

    return { response, $: load(response.result ?? '') }
  }

  async function post(url, payload = {}) {
    const response = await server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, ...payload }
    })

    cookies = mergeCookies(cookies, response)

    return { response, $: load(response.result ?? '') }
  }

  function writes() {
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        url.includes('/v1/') &&
        !url.includes('/v1/users/me') &&
        !url.endsWith('/federations/check') &&
        init?.method &&
        init.method !== 'GET'
    )
  }

  function statusChangeRead() {
    return fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter(({ pathname }) => pathname === `${TEAM_PATH}/status-changes`)
  }

  function expectCannotChange({ response, $ }, backHref) {
    expect(response.statusCode).toBe(statusCodes.conflict)
    expect(text($, 'h1')).toBe(CANNOT_CHANGE)
    expect($('title').text()).toContain(CANNOT_CHANGE)
    expect($(`main a[href="${backHref}"]`)).toHaveLength(1)
  }

  describe('the overview', () => {
    test('shows the banner and the status, leaves an environment that was not ticked Available and keeps Deploy a model open', async () => {
      backend(DISABLED)

      const { response, $ } = await get(OVERVIEW_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, '[data-testid="team-status"]')).toBe('Status: Disabled')
      expect(text($, '[data-testid="team-lock-banner"]')).toContain(
        'This team is disabled'
      )
      expect(
        text(
          $,
          '[data-testid="environment-card-infradev"] [data-testid="card-tag"]'
        )
      ).toBe('Available')
      expect($(`${TOP_ACTIONS} a[data-testid="deploy-a-model"]`)).toHaveLength(
        1
      )
    })

    test('says Disabled where a card said Available, and greys Deploy a model, for a disabled environment', async () => {
      backend(INFRADEV_DISABLED, {
        [`GET ${TEAM_PATH}/environments`]: environmentsRead([
          summary({ disabled: true })
        ])
      })

      const { $ } = await get(OVERVIEW_URL)
      const deploy = $(`${TOP_ACTIONS} [data-testid="deploy-a-model"]`)

      expect(
        text(
          $,
          '[data-testid="environment-card-infradev"] [data-testid="card-tag"]'
        )
      ).toBe('Disabled')
      expect(deploy.is('button')).toBe(true)
      expect(deploy.attr('disabled')).toBeDefined()
      expect(deploy.attr('href')).toBeUndefined()
    })

    test('greys Create Passwordless Credential when every environment with room is disabled, and keeps it open when one is not', async () => {
      backend(INFRADEV_DISABLED, {
        [`GET ${TEAM_PATH}/environments`]: environmentsRead([
          summary({ disabled: true })
        ])
      })

      const greyed = (await get(OVERVIEW_URL)).$(
        `${TOP_ACTIONS} [data-testid="federate-an-application"]`
      )

      expect(greyed.is('button')).toBe(true)
      expect(greyed.attr('disabled')).toBeDefined()

      backend(INFRADEV_DISABLED, {
        [`GET ${TEAM_PATH}/environments`]: environmentsRead([
          summary({ disabled: true }),
          summary({ environment: 'qa' })
        ])
      })

      const open = (await get(OVERVIEW_URL)).$(
        `${TOP_ACTIONS} [data-testid="federate-an-application"]`
      )

      expect(open.is('a')).toBe(true)
    })

    test('still offers setting up another environment as a link while the team is disabled, because a disabled team can still set one up', async () => {
      const notSetUp = {
        environment: 'qa',
        setUp: false,
        limits: null,
        models: { count: 0, items: [] }
      }

      backend(DISABLED, {
        [`GET ${TEAM_PATH}/environments`]: environmentsRead([
          summary(),
          summary(notSetUp)
        ])
      })

      const { $ } = await get(OVERVIEW_URL)

      expect($('a[data-testid="set-up-environment"]').attr('href')).toBe(
        QA_SET_UP_URL
      )
      expect($('[data-testid="set-up-environment-locked"]')).toHaveLength(0)
    })

    test('offers setting up an environment as a link when the team is not disabled', async () => {
      backend(ACTIVE, {
        [`GET ${TEAM_PATH}/environments`]: environmentsRead([
          summary(),
          summary({
            environment: 'qa',
            setUp: false,
            limits: null,
            models: { count: 0, items: [] }
          })
        ])
      })

      const { $ } = await get(OVERVIEW_URL)

      expect($('a[data-testid="set-up-environment"]').attr('href')).toBe(
        QA_SET_UP_URL
      )
      expect($('[data-testid="team-lock-banner"]')).toHaveLength(0)
    })

    test('shows the page as it was before the lock when the team cannot be read for it, since the backend refuses a locked change anyway', async () => {
      backend(reply(502, { code: 'upstream-unavailable' }))

      const { response, $ } = await get(OVERVIEW_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="team-lock-banner"]')).toHaveLength(0)
    })
  })

  describe('Recent changes', () => {
    const disabled = {
      change: 'disabled',
      environments: ['infradev'],
      at: '2026-11-12T11:00:00.000Z'
    }
    const enabled = {
      change: 'enabled',
      environments: [],
      at: '2026-11-12T11:30:00.000Z'
    }

    function rows($) {
      return $('[data-testid="recent-change"]')
        .map((_, row) => [
          [text($(row), 'td:nth-child(1)'), text($(row), 'td:nth-child(2)')]
        ])
        .get()
    }

    test('lists the platform team’s disable and enable among the other changes, newest first, with no reason and no name', async () => {
      backend(ACTIVE, {
        [`GET ${TEAM_PATH}/operations`]: operationsAnswer({
          recent: [doneOperation({ createdAt: '2026-11-12T10:44:00.000Z' })]
        }),
        [`GET ${TEAM_PATH}/status-changes`]: {
          items: [enabled, disabled]
        }
      })

      const { $, response } = await get(OVERVIEW_URL)

      expect(rows($).map(([, change]) => change)).toEqual([
        'Team enabled by the platform team',
        'Team disabled by the platform team in Infradev',
        'Deploy GPT-4o in Infradev'
      ])
      expect(text($, '[data-testid="section-recent"]')).not.toMatch(
        /reason|Jo Bloggs|@/
      )
      expect(response.result).not.toContain('"reason"')
    })

    test('asks for the same row limit as the operations, and keeps to it', async () => {
      const recent = Array.from({ length: 10 }, (_, index) =>
        doneOperation({
          id: `op-${index}`,
          createdAt: `2026-11-12T10:${String(10 + index)}:00.000Z`
        })
      )

      backend(ACTIVE, {
        [`GET ${TEAM_PATH}/operations`]: operationsAnswer({ recent }),
        [`GET ${TEAM_PATH}/status-changes`]: { items: [enabled] }
      })

      const { $ } = await get(OVERVIEW_URL)

      expect(statusChangeRead()[0].searchParams.get('limit')).toBe('10')
      expect($('[data-testid="recent-change"]')).toHaveLength(10)
      expect(rows($)[0][1]).toBe('Team enabled by the platform team')
    })

    test('says it could not read the changes when the status changes could not be read, on the overview and the environment page', async () => {
      backend(ACTIVE, {
        [`GET ${TEAM_PATH}/status-changes`]: reply(502, {
          code: 'upstream-unavailable'
        })
      })

      for (const url of [OVERVIEW_URL, INFRADEV_URL]) {
        const { response, $ } = await get(url)

        expect(response.statusCode).toBe(statusCodes.ok)
        expect(text($, '[data-testid="section-recent"]')).toContain(
          'We could not read the changes just now.'
        )
      }
    })

    test('reads the status changes of the environment alone on its page, and shows them without the environment named', async () => {
      backend(ACTIVE, {
        [`GET ${TEAM_PATH}/status-changes`]: { items: [disabled] }
      })

      const { $ } = await get(INFRADEV_URL)

      expect(statusChangeRead().at(-1).searchParams.get('environment')).toBe(
        'infradev'
      )
      expect(rows($).map(([, change]) => change)).toEqual([
        'Team disabled by the platform team'
      ])
    })
  })

  describe('an environment’s page', () => {
    function backendFor(read, { applications = true } = {}) {
      backend(read, {
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          disabled: read === INFRADEV_ONLY || read === INFRADEV_DISABLED,
          clientSecrets: clientSecretsOf([clientSecretItem()]),
          applications: applications
            ? applicationsOf([federatedApplication()])
            : undefined
        })
      })
    }

    test('tags a disabled environment Disabled, explains it in a banner, and greys every environment action but revoking the client secret', async () => {
      backendFor(INFRADEV_DISABLED)

      const { response, $ } = await get(INFRADEV_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(text($, '[data-testid="environment-tag"]')).toBe('Disabled')
      expect(text($, '[data-testid="team-lock-banner"]')).toContain(
        'This environment is disabled'
      )

      const deploy = $('[data-testid="deploy-a-model"]')

      expect(deploy.is('button')).toBe(true)
      expect(deploy.attr('disabled')).toBeDefined()
      expect($('a[data-testid="model-remove"]')).toHaveLength(0)
      expect($('[data-testid="model-remove-locked"]')).toHaveLength(2)
      expect($('a[href$="/view"], a[href$="/rotate"]')).toHaveLength(0)
      expect(text($, '[data-testid="client-secret-view-locked"]')).toContain(
        'View'
      )
      expect(text($, '[data-testid="client-secret-rotate-locked"]')).toContain(
        'Rotate'
      )
      expect(
        $('[data-testid="client-secret-row"] a[href$="/revoke"]')
      ).toHaveLength(1)
      expect($('a[data-testid="add-client-secret"]')).toHaveLength(0)
      expect(
        $(
          '[data-testid="section-client-secrets"] button[data-testid="add-client-secret"]'
        )
      ).toHaveLength(1)
      expect($('a[data-testid="change-limits"]')).toHaveLength(0)
      expect($('[data-testid="change-limits-locked"]')).toHaveLength(1)
      expect(
        $(
          '[data-testid="section-applications"] [data-testid="federate-an-application"]'
        ).is('button')
      ).toBe(true)
      expect($('a[data-testid="application-change"]')).toHaveLength(0)
      expect($('a[data-testid="application-remove"]')).toHaveLength(0)
      expect($('[data-testid="application-change-locked"]')).toHaveLength(1)
      expect($('[data-testid="application-remove-locked"]')).toHaveLength(1)
    })

    test('says only the environment is disabled when the team is active', async () => {
      backendFor(INFRADEV_ONLY)

      const { $ } = await get(INFRADEV_URL)

      expect(text($, '[data-testid="environment-tag"]')).toBe('Disabled')
      expect(text($, '[data-testid="team-lock-banner"]')).toContain(
        'This environment is disabled'
      )
      expect($('[data-testid="team-status"]')).toHaveLength(0)
    })

    test('leaves an environment that is not disabled fully usable for a disabled team, with no banner of the team on its page', async () => {
      backendFor(DISABLED)

      const { $ } = await get(INFRADEV_URL)

      expect(text($, '[data-testid="environment-tag"]')).toBe('Available')
      expect($('[data-testid="team-lock-banner"]')).toHaveLength(0)
      expect($('a[data-testid="deploy-a-model"]')).toHaveLength(1)
      expect($('a[data-testid="model-remove"]')).toHaveLength(2)
      expect($('a[data-testid="change-limits"]')).toHaveLength(1)
      expect($('a[data-testid="application-change"]')).toHaveLength(1)
      expect($('[data-testid="model-remove-locked"]')).toHaveLength(0)
    })

    test('shows a member the banner and nothing greyed, since they had no change to make', async () => {
      backendFor(
        teamRead(
          { status: 'disabled', disabledEnvironments: ['infradev'] },
          'user'
        )
      )

      const { $ } = await get(INFRADEV_URL)

      expect($('[data-testid="team-lock-banner"]')).toHaveLength(1)
      expect($('[data-testid="model-remove-locked"]')).toHaveLength(0)
      expect($('[data-testid="change-limits-locked"]')).toHaveLength(0)
    })
  })

  describe('a change asked for a page of its own', () => {
    test('shows changing the limits in a disabled environment as the 409 page, with a link back, and the same posted', async () => {
      backend(INFRADEV_DISABLED)

      expectCannotChange(await get(LIMITS_URL), INFRADEV_URL)
      expectCannotChange(
        await post(LIMITS_URL, {
          tokensPerMinute: '100',
          requestsPerMinute: '10'
        }),
        INFRADEV_URL
      )
      expect(writes()).toEqual([])
    })

    test('still offers the limits in an environment the admin did not tick', async () => {
      backend(DISABLED)

      const { response } = await get(LIMITS_URL)

      expect(response.statusCode).toBe(statusCodes.ok)
    })

    test('shows the limits page as the environment’s when the environment read says it is disabled', async () => {
      backend(ACTIVE, {
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({ disabled: true })
      })

      const { response, $ } = await get(LIMITS_URL)

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, 'main')).toContain(
        'This environment is disabled. You can view it but not change it.'
      )
    })

    test('does not refuse setting up an environment while the team is disabled: a disabled team can still set one up', async () => {
      backend(DISABLED)

      const { response } = await get(QA_SET_UP_URL)

      expect(response.statusCode).not.toBe(statusCodes.conflict)
    })

    test('shows setting up an environment that is itself disabled as the 409 page', async () => {
      backend(teamRead({ status: 'active', disabledEnvironments: ['qa'] }))

      expectCannotChange(await get(QA_SET_UP_URL), `${OVERVIEW_URL}/qa`)
    })

    test.each([
      ['change', 'GET'],
      ['remove', 'GET'],
      ['remove', 'POST']
    ])(
      'shows %s an application (%s) in a disabled environment as the 409 page',
      async (action, method) => {
        backend(INFRADEV_DISABLED, {
          [`GET ${TEAM_PATH}/environments/infradev`]: detail({
            applications: applicationsOf([federatedApplication()])
          })
        })

        const url = `${INFRADEV_URL}/applications/app-1/${action}`
        const result = method === 'GET' ? await get(url) : await post(url)

        expectCannotChange(result, INFRADEV_URL)
        expect(writes()).toEqual([])
      }
    )

    test('shows removing an application as the 409 page when the backend refuses it with team-disabled', async () => {
      backend(ACTIVE, {
        [`GET ${TEAM_PATH}/environments/infradev`]: detail({
          applications: applicationsOf([federatedApplication()])
        }),
        [`DELETE ${TEAM_PATH}/environments/infradev/federations/app-1`]:
          TEAM_DISABLED
      })

      const { response, $ } = await post(
        `${INFRADEV_URL}/applications/app-1/remove`
      )

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, 'h1')).toBe(CANNOT_CHANGE)
    })

    test('shows changing the limits as the 409 page when the backend refuses it with team-disabled', async () => {
      backend(ACTIVE, {
        [`PUT ${TEAM_PATH}/environments/infradev/limits`]: TEAM_DISABLED
      })

      await post(LIMITS_URL, {
        tokensPerMinute: '100',
        requestsPerMinute: '10'
      })

      const key = (await get(`${LIMITS_URL}/check`))
        .$('input[name="key"]')
        .attr('value')
      const { response, $ } = await post(`${LIMITS_URL}/check`, { key })

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, 'h1')).toBe(CANNOT_CHANGE)
    })
  })

  describe('the Federate journey', () => {
    async function toEnvironments() {
      await post(FEDERATE_URL, { host: 'cdp' })
      await post(`${FEDERATE_URL}/service`, { service: 'flood-api' })

      return get(`${FEDERATE_URL}/environments`)
    }

    test('does not offer an environment the dry run says is disabled, and offers the others', async () => {
      config.set('teamEnvironments', ['infradev', 'qa', 'preprod'])
      backend(ACTIVE, {
        [`POST ${FEDERATIONS_PATH}/check`]: dryRun({
          infradev: 'team-disabled'
        })
      })

      const { response, $ } = await toEnvironments()

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(
        $('input[name="environments"]')
          .map((_, input) => $(input).val())
          .get()
      ).toEqual(['qa', 'preprod'])
    })

    test('still asks which environment when only one is left because the others are disabled, so people see where it will go', async () => {
      backend(ACTIVE, {
        [`POST ${FEDERATIONS_PATH}/check`]: dryRun({
          infradev: 'team-disabled'
        })
      })

      const { response, $ } = await toEnvironments()

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(
        $('input[name="environments"]')
          .map((_, input) => $(input).val())
          .get()
      ).toEqual(['qa'])
    })

    test('says the environment is disabled, as the 409 page, when every environment that could take it is', async () => {
      config.set('teamEnvironments', ['infradev'])
      backend(ACTIVE, {
        [`POST ${FEDERATIONS_PATH}/check`]: dryRun({
          infradev: 'team-disabled'
        })
      })

      const { response, $ } = await toEnvironments()

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, 'h1')).toBe(CANNOT_CHANGE)
      expect(text($, 'main')).toContain('This environment is disabled')
    })

    describe('the environments question straight after the host, before the application is named', () => {
      function offeredEnvironments($) {
        return $('input[name="environments"]')
          .map((_, input) => $(input).val())
          .get()
      }

      async function afterHost() {
        await post(FEDERATE_URL, { host: 'cdp' })

        return get(`${FEDERATE_URL}/environments`)
      }

      test.each([
        [
          'the environment read says it is disabled',
          ACTIVE,
          [summary({ disabled: true }), summary({ environment: 'qa' })]
        ],
        [
          'the team lists it as disabled',
          INFRADEV_ONLY,
          [summary(), summary({ environment: 'qa' })]
        ]
      ])(
        'does not offer or accept an environment when %s',
        async (_, read, summaries) => {
          backend(read, {
            [`GET ${TEAM_PATH}/environments`]: environmentsRead(summaries)
          })

          const { response, $ } = await afterHost()

          expect(response.statusCode).toBe(statusCodes.ok)
          expect(offeredEnvironments($)).toEqual(['qa'])

          const posted = await post(`${FEDERATE_URL}/environments`, {
            environments: ['infradev']
          })

          expect(posted.response.statusCode).toBe(statusCodes.badRequest)
          expect(text(posted.$, '.govuk-error-summary')).toContain(
            'Select environments from the list'
          )
        }
      )

      test('says the environment is disabled, as the 409 page, when every environment with room is', async () => {
        backend(INFRADEV_DISABLED, {
          [`GET ${TEAM_PATH}/environments`]: environmentsRead([
            summary({ disabled: true })
          ])
        })

        const { response, $ } = await afterHost()

        expect(response.statusCode).toBe(statusCodes.conflict)
        expect(text($, 'h1')).toBe(CANNOT_CHANGE)
        expect(text($, 'main')).toContain('This environment is disabled')
      })
    })

    test('names a disabled environment in words when the backend refuses it on confirming', async () => {
      backend(ACTIVE, {
        [`POST ${FEDERATIONS_PATH}`]: reply(409, {
          statusCode: 409,
          code: 'federation-refused',
          message: 'Refused',
          environments: [{ environment: 'infradev', code: 'team-disabled' }]
        })
      })
      await toEnvironments()
      await post(`${FEDERATE_URL}/environments`, { environments: ['infradev'] })

      const key = (await get(`${FEDERATE_URL}/check`))
        .$('input[name="key"]')
        .attr('value')
      const { response, $ } = await post(`${FEDERATE_URL}/check`, { key })

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, '.govuk-error-summary')).toContain(
        'Infradev is disabled. You can view it but not change it'
      )
    })
  })

  describe('the request journey', () => {
    test('does not start a request in a disabled environment: the 409 page, with a link back to its page', async () => {
      backend(INFRADEV_DISABLED)

      const { response, $ } = await get(
        `/connect/team/start?teamId=${sampleTeam.slug}&environment=infradev`
      )

      expect(response.statusCode).toBe(statusCodes.conflict)
      expect(text($, 'h1')).toBe(CANNOT_CHANGE)
      expect($(`main a[href="${INFRADEV_URL}"]`)).toHaveLength(1)
    })

    test('starts one in an environment that was not ticked, though the team is disabled', async () => {
      backend(DISABLED)

      const { response } = await get(
        `/connect/team/start?teamId=${sampleTeam.slug}&environment=infradev`
      )

      expect(response.statusCode).toBe(statusCodes.found)
      expect(response.headers.location).toBe('/connect/team/model')
    })
  })
})

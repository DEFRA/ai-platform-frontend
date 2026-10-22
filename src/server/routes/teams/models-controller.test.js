import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const TEAM_PATH = `/v1/teams/${sampleTeam.slug}`
const TEAM_URL = `/teams/${sampleTeam.slug}`
const REMOVE_URL = `${TEAM_URL}/models/deployment-1/remove`
const DEPLOYMENT_PATH = `${TEAM_PATH}/deployments/deployment-1`
const NOT_FOUND = reply(404, { code: 'not-found', message: 'Not Found' })

function deployment(overrides = {}) {
  return {
    _id: 'deployment-1',
    teamId: 'team-1',
    modelSlug: 'gpt-4o',
    environment: 'infradev',
    status: 'active',
    ...overrides
  }
}

describe('#removeModelController', () => {
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

  function backend({ role = 'admin', current = deployment(), ...routes } = {}) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: { ...teamWithMembers(role), environments: [] },
      [`GET ${DEPLOYMENT_PATH}`]: { deployment: current },
      'GET /v1/models/gpt-4o': sampleModel,
      ...routes
    })
  }

  function get(url, jar = cookies) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(jar) }
    })
  }

  function post(url = REMOVE_URL) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
  }

  // The Models tab, as the redirect after a removal opens it.
  async function openTeamPage(response) {
    mockApi(fetchMock, {
      [`GET ${TEAM_PATH}`]: { ...teamWithMembers('admin'), environments: [] },
      [`GET ${TEAM_PATH}/deployments`]: { items: [deployment()] },
      'GET /v1/models': { items: [sampleModel] },
      'GET /v1/credentials': { items: [] }
    })

    return get(TEAM_URL, mergeCookies(cookies, response))
  }

  describe('asking an admin to confirm', () => {
    test('names the model and the environment, says what stops and what stays, and has a Cancel link', async () => {
      backend()

      const { statusCode, result } = await get(REMOVE_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(
        /govuk-caption-xl[^>]*>Flood Risk Team<\/span>\s*<h1[^>]*>Remove GPT-4o from Development\?<\/h1>/
      )
      expect(result).toContain(
        'Anything using GPT-4o through your team’s address will stop working as soon as it has been removed. Your team’s other models and its client secret are not affected.'
      )
      expect(result).toContain(
        'Removing takes a few minutes. You can add the model again later.'
      )
      expect(result).toMatch(
        /govuk-button--warning[^>]*>\s*Remove GPT-4o\s*<\/button>/
      )
      expect(result).toContain(
        `href="${TEAM_URL}" data-testid="remove-model-cancel">Cancel`
      )
      expect(result).toContain(
        `<a href="${TEAM_URL}" class="govuk-back-link">Back</a>`
      )
    })

    test.each(['checks-failed', 'deploy-failed'])(
      'says nothing is using a model that %s',
      async (status) => {
        backend({ current: deployment({ status }) })

        const { statusCode, result } = await get(REMOVE_URL)

        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toContain('It was never set up, so nothing is using it.')
        expect(result).not.toContain('will stop working')
      }
    )

    test('names the model by its slug when the catalogue cannot say', async () => {
      backend({
        'GET /v1/models/gpt-4o': reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode, result } = await get(REMOVE_URL)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Remove gpt-4o from Development?')
    })

    test.each([
      ['a member who is not an admin', { role: 'user' }],
      [
        'someone who is not on the team, such as a person with only their own keys',
        { [`GET ${TEAM_PATH}`]: NOT_FOUND }
      ],
      [
        'a model that is not the team’s',
        { [`GET ${DEPLOYMENT_PATH}`]: NOT_FOUND }
      ],
      [
        'a model still being set up',
        { current: deployment({ status: 'deploying' }) }
      ],
      [
        'a model already being removed',
        { current: deployment({ status: 'removing' }) }
      ]
    ])('is not found for %s', async (_who, overrides) => {
      backend(overrides)

      const { statusCode, result } = await get(REMOVE_URL)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Model not found')
      expect(result).not.toContain('Remove GPT-4o')
    })

    test('fails rather than hiding a team lookup that broke', async () => {
      backend({
        [`GET ${TEAM_PATH}`]: reply(502, { code: 'upstream-unavailable' })
      })

      const { statusCode } = await get(REMOVE_URL)

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  describe('removing it', () => {
    test('asks the backend to remove it, and the Models tab says it is on its way, once', async () => {
      backend({
        [`DELETE ${DEPLOYMENT_PATH}`]: reply(202, {
          deployment: deployment({ status: 'removing' })
        })
      })

      const removed = await post()

      expect(removed.statusCode).toBe(statusCodes.seeOther)
      expect(removed.headers.location).toBe(TEAM_URL)

      const [, init] = fetchMock.mock.calls.find(
        ([url, options]) =>
          url.includes(DEPLOYMENT_PATH) && options.method === 'DELETE'
      )

      expect(init.headers['x-user-id']).toBe('user-1')

      const jar = mergeCookies(cookies, removed)
      const page = await openTeamPage(removed)

      expect(page.result).toContain('data-testid="team-notification"')
      expect(page.result).toContain('govuk-notification-banner--success')
      expect(page.result).toContain(
        '<h3 class="govuk-notification-banner__heading">GPT-4o is being removed from Development</h3>'
      )
      expect(page.result).toContain(
        'Apps using it through your team’s address will stop working once it has gone. This takes a few minutes.'
      )
      // The banner sits above the caption, and is shown only once.
      expect(page.result.indexOf('team-notification')).toBeLessThan(
        page.result.indexOf('govuk-caption-xl')
      )

      const again = await get(TEAM_URL, mergeCookies(jar, page))

      expect(again.result).not.toContain('data-testid="team-notification"')
    })

    test('reports a model that was removed at once', async () => {
      backend({
        [`DELETE ${DEPLOYMENT_PATH}`]: {
          deployment: deployment({ status: 'removed' })
        }
      })

      const page = await openTeamPage(await post())

      expect(page.result).toContain('GPT-4o has been removed from Development')
    })

    test.each([
      [
        'deployment-in-progress',
        'This model is still being set up. Try again once it is ready.'
      ],
      [
        'team-file-busy',
        'Another change to this team is in progress. Try again in a few minutes.'
      ],
      ['admin-required', 'Only a team admin can remove a model.'],
      ['some-new-code', 'The backend’s own words.']
    ])('explains a refusal (%s) in the same place', async (code, message) => {
      backend({
        [`DELETE ${DEPLOYMENT_PATH}`]: reply(409, {
          statusCode: 409,
          error: 'Conflict',
          message: 'The backend’s own words.',
          code
        })
      })

      const removed = await post()

      expect(removed.statusCode).toBe(statusCodes.seeOther)
      expect(removed.headers.location).toBe(TEAM_URL)

      const page = await openTeamPage(removed)

      expect(page.result).toContain('data-testid="team-notification"')
      expect(page.result).not.toContain('govuk-notification-banner--success')
      expect(page.result).toContain(message)
    })

    test('surfaces an unknown model as not found', async () => {
      backend({ [`DELETE ${DEPLOYMENT_PATH}`]: NOT_FOUND })

      const { statusCode, result } = await post()

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Model not found')
    })

    test('fails rather than hiding a broken backend', async () => {
      backend({
        [`DELETE ${DEPLOYMENT_PATH}`]: reply(502, {
          code: 'upstream-unavailable',
          message: 'GitOps is down'
        })
      })

      const { statusCode } = await post()

      expect(statusCode).toBe(statusCodes.internalServerError)
    })
  })

  test('is for signed-in people only', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: REMOVE_URL
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toContain('/sign-in')
  })
})

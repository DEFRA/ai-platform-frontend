import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
  nanoModel,
  sampleModel,
  sampleTeam,
  teamConnectHelpers
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

const { mockResponse, get, reachTeamStep, mockModelChoices, mockTeamChoices } =
  teamConnectHelpers(fetchMock)

describe('#startController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('when signed out', () => {
    test.each([
      ['/connect/shared/start', '%2Fconnect%2Fshared%2Fstart'],
      ['/connect/team/start', '%2Fconnect%2Fteam%2Fstart']
    ])('GET %s sends the person to sign in', async (url, returnTo) => {
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url
      })

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe(`/sign-in?returnTo=${returnTo}`)
    })

    test('GET /connect/team/start keeps the model through signing in', async () => {
      const { headers } = await server.inject({
        method: 'GET',
        url: '/connect/team/start?modelSlug=gpt-4o'
      })

      expect(headers.location).toBe(
        '/sign-in?returnTo=%2Fconnect%2Fteam%2Fstart%3FmodelSlug%3Dgpt-4o'
      )
    })
  })

  describe('Try it on your own', () => {
    test('GET /connect/shared/start goes to the model step when no model is given', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode, headers } = await get(
        server,
        cookies,
        '/connect/shared/start'
      )

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/connect/shared/model')
    })

    test('GET /connect/shared/start skips to the details when a model is given, and keeps it', async () => {
      let cookies = await signInViaOidc(server, fetchMock)

      const start = await get(
        server,
        cookies,
        '/connect/shared/start?modelSlug=gpt-4o'
      )
      cookies = mergeCookies(cookies, start)

      expect(start.statusCode).toBe(statusCodes.found)
      expect(start.headers.location).toBe('/connect/shared/details')

      mockResponse(sampleModel)
      const details = await get(server, cookies, '/connect/shared/details')

      expect(details.statusCode).toBe(statusCodes.ok)
      expect(details.result).toContain('What will you use GPT-4o for?')
    })

    test('GET /connect/shared/start leaves no model ticked on the model step when none was given', async () => {
      let cookies = await signInViaOidc(server, fetchMock)
      cookies = mergeCookies(
        cookies,
        await get(server, cookies, '/connect/shared/start')
      )

      mockResponse({ items: [sampleModel] })
      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/shared/model'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toContain('checked')
    })

    test('GET /connect/shared/start drops a team journey left in the session', async () => {
      let cookies = await reachTeamStep(
        server,
        await signInViaOidc(server, fetchMock),
        { modelSlug: 'gpt-4o' }
      )
      cookies = mergeCookies(
        cookies,
        await get(server, cookies, '/connect/shared/start')
      )

      const { headers } = await get(server, cookies, '/connect/team/model')

      expect(headers.location).toBe('/models')
    })
  })

  describe('Add to a team', () => {
    test('GET /connect/team/start goes to choosing a team', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode, headers } = await get(
        server,
        cookies,
        '/connect/team/start'
      )

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe('/connect/team/select')
    })

    test('GET /connect/team/start?modelSlug= carries the model to the model step, ticked', async () => {
      const cookies = await reachTeamStep(
        server,
        await signInViaOidc(server, fetchMock),
        { modelSlug: 'gpt-4o' }
      )

      mockModelChoices({ models: [sampleModel, nanoModel] })
      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/model'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(/value="gpt-4o"[^>]*checked/)
    })

    test('GET /connect/team/start offers whichever teams the person belongs to', async () => {
      let cookies = await signInViaOidc(server, fetchMock)
      cookies = mergeCookies(
        cookies,
        await get(server, cookies, '/connect/team/start')
      )

      mockTeamChoices({
        teams: [
          sampleTeam,
          {
            _id: 'team-2',
            slug: 'waste-crime-team',
            name: 'Waste Crime Team',
            role: 'user'
          }
        ]
      })
      const { statusCode, result } = await get(
        server,
        cookies,
        '/connect/team/select'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Flood Risk Team')
      expect(result).toContain('Waste Crime Team')
    })

    test('GET /connect/team/start sends a person with no team to create one', async () => {
      let cookies = await signInViaOidc(server, fetchMock)
      cookies = mergeCookies(
        cookies,
        await get(server, cookies, '/connect/team/start')
      )

      mockTeamChoices({ teams: [] })
      const { headers } = await get(server, cookies, '/connect/team/select')

      expect(headers.location).toBe(
        '/teams/new?returnTo=%2Fconnect%2Fteam%2Fselect'
      )
    })
  })

  describe('a model that is not a slug', () => {
    test.each([
      '/connect/shared/start?modelSlug=GPT 4o',
      '/connect/team/start?modelSlug=../admin',
      '/connect/team/start?modelSlug='
    ])('GET %s is refused', async (url) => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode } = await get(server, cookies, encodeURI(url))

      expect(statusCode).toBe(statusCodes.badRequest)
    })

    test('GET /connect/team/start refuses any other query', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode } = await get(
        server,
        cookies,
        '/connect/team/start?teamId=team-1'
      )

      expect(statusCode).toBe(statusCodes.badRequest)
    })
  })

  describe('the old access-type step', () => {
    test('is gone: GET and POST /connect are not found', async () => {
      const cookies = await signInViaOidc(server, fetchMock)
      const headers = { cookie: cookieHeader(cookies) }

      const getResponse = await server.inject({
        method: 'GET',
        url: '/connect',
        headers
      })
      const postResponse = await server.inject({
        method: 'POST',
        url: '/connect',
        headers,
        payload: { crumb: cookies.crumb, accessType: 'team' }
      })

      expect(getResponse.statusCode).toBe(statusCodes.notFound)
      expect(postResponse.statusCode).toBe(statusCodes.notFound)
    })
  })
})

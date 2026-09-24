import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const sampleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai',
  description: 'Multimodal OpenAI model.',
  deploymentName: 'gpt-4o',
  apiVersion: '2024-05-01-preview',
  endpoint: 'https://mock-gateway.ai-platform.defra.gov.uk/openai/gpt-4o',
  limits: { requestsPerMinute: 60 }
}

/**
 * Exercises the full B03-B07 Route 1 journey through the frontend in one
 * test, with every external dependency mocked exactly where the architecture
 * already isolates it: Entra ID (vi.mock above), and the backend API
 * (fetchMock) - which in production is itself backed by the backend's mocked
 * Azure APIM adapter, so nothing in this chain depends on real cloud
 * infrastructure.
 */
describe('B03-B07 full journey (sign in, connect a shared model, renew, revoke)', () => {
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

  test('sign in -> connect a shared model -> renew -> revoke', async () => {
    // B03: sign in (no team step)
    let cookies = await signInViaOidc(server, fetchMock)

    // B06: choose access type, choose a model
    const postAccessType = await server.inject({
      method: 'POST',
      url: '/connect',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, accessType: 'shared' }
    })
    cookies = mergeCookies(cookies, postAccessType)
    expect(postAccessType.statusCode).toBe(303)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    const getSelectModel = await server.inject({
      method: 'GET',
      url: '/connect/shared/model',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getSelectModel)

    const postSelectModel = await server.inject({
      method: 'POST',
      url: '/connect/shared/model',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, modelSlug: 'gpt-4o' }
    })
    cookies = mergeCookies(cookies, postSelectModel)
    expect(postSelectModel.statusCode).toBe(303)

    // B06: say what it is for
    const postDetails = await server.inject({
      method: 'POST',
      url: '/connect/shared/details',
      headers: { cookie: cookieHeader(cookies) },
      payload: {
        crumb: cookies.crumb,
        purpose: 'Journey test',
        agreeToTerms: 'true'
      }
    })
    cookies = mergeCookies(cookies, postDetails)
    expect(postDetails.statusCode).toBe(303)

    // B06: check your answers and issue the credential
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getCheck = await server.inject({
      method: 'GET',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCheck)

    const issuedCredential = {
      _id: 'cred-journey-1',
      modelSlug: 'gpt-4o',
      status: 'active',
      keyHint: 'jr01',
      expiresAt: '2026-09-25T00:00:00.000Z',
      renewalCount: 0,
      renewalsRemaining: 3
    }
    fetchMock.mockResponseOnce(
      JSON.stringify({ credential: issuedCredential, secret: 'mock_secret' })
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postCheck)
    expect(postCheck.statusCode).toBe(303)
    expect(postCheck.headers.location).toBe('/connect/shared/credential')

    const getCredential = await server.inject({
      method: 'GET',
      url: '/connect/shared/credential',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCredential)
    expect(getCredential.result).toEqual(
      expect.stringContaining('Manage your credentials')
    )

    // B07: the credential appears on /manage
    fetchMock.mockResponseOnce(JSON.stringify({ items: [issuedCredential] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const getManage = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getManage)
    expect(getManage.statusCode).toBe(statusCodes.ok)
    expect(getManage.result).toEqual(expect.stringContaining('GPT-4o'))

    // B07: renew it
    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...issuedCredential,
        renewalCount: 1,
        renewalsRemaining: 2,
        expiresAt: '2026-10-02T00:00:00.000Z'
      })
    )
    const postRenew = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-journey-1/renew',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, postRenew)
    expect(postRenew.statusCode).toBe(303)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [{ ...issuedCredential, renewalCount: 1, renewalsRemaining: 2 }]
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const getManageAfterRenew = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getManageAfterRenew)
    expect(getManageAfterRenew.result).toEqual(
      expect.stringContaining('Credential renewed')
    )

    // B07: revoke it
    fetchMock.mockResponseOnce(JSON.stringify(issuedCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getRevokeConfirm = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-journey-1/revoke',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getRevokeConfirm)
    expect(getRevokeConfirm.statusCode).toBe(statusCodes.ok)

    fetchMock.mockResponseOnce(null, { status: 204 })
    const postRevoke = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-journey-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, confirmRevoke: 'yes' }
    })
    cookies = mergeCookies(cookies, postRevoke)
    expect(postRevoke.statusCode).toBe(303)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [{ ...issuedCredential, status: 'revoked' }]
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    const getManageAfterRevoke = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getManageAfterRevoke.result).toEqual(
      expect.stringContaining('Credential revoked')
    )
    expect(getManageAfterRevoke.result).toEqual(
      expect.stringContaining('revoked')
    )
  })
})

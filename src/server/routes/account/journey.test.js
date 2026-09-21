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
 * Exercises the full J1-J4 journey through the frontend in one test, with
 * every external dependency mocked exactly where the architecture already
 * isolates it: Entra ID (vi.mock above), and the backend API (fetchMock) —
 * which in production is itself backed by the backend's mocked Azure APIM
 * adapter, so nothing in this chain depends on real cloud infrastructure.
 */
describe('J1-J4 full journey (sign in, connect a model, manage the credential)', () => {
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

  test('sign in -> connect a model -> renew -> revoke', async () => {
    // J1: sign in
    let cookies = await signInViaOidc(server, fetchMock)

    // J3: choose a provider, select a model
    const postChooseProvider = await server.inject({
      method: 'POST',
      url: '/connect-model',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, provider: 'openai' }
    })
    cookies = mergeCookies(cookies, postChooseProvider)
    expect(postChooseProvider.statusCode).toBe(303)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    const getSelectModel = await server.inject({
      method: 'GET',
      url: '/connect-model/select-model',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getSelectModel)

    const postSelectModel = await server.inject({
      method: 'POST',
      url: '/connect-model/select-model',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, modelSlug: 'gpt-4o' }
    })
    cookies = mergeCookies(cookies, postSelectModel)
    expect(postSelectModel.statusCode).toBe(303)

    // J3: confirm and issue the credential
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getConfirm = await server.inject({
      method: 'GET',
      url: '/connect-model/confirm',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getConfirm)

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
    const postConfirm = await server.inject({
      method: 'POST',
      url: '/connect-model/confirm',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, agreeToTerms: 'true' }
    })
    cookies = mergeCookies(cookies, postConfirm)
    expect(postConfirm.statusCode).toBe(303)
    expect(postConfirm.headers.location).toBe('/connect-model/credential')

    const getCredential = await server.inject({
      method: 'GET',
      url: '/connect-model/credential',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCredential)
    expect(getCredential.result).toEqual(
      expect.stringContaining('Manage your credentials')
    )

    // J4: the credential appears on the account page
    fetchMock.mockResponseOnce(JSON.stringify({ items: [issuedCredential] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    const getAccount = await server.inject({
      method: 'GET',
      url: '/account',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getAccount)
    expect(getAccount.statusCode).toBe(statusCodes.ok)
    expect(getAccount.result).toEqual(expect.stringContaining('GPT-4o'))

    // J4: renew it
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
      url: '/account/credentials/cred-journey-1/renew',
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
    const getAccountAfterRenew = await server.inject({
      method: 'GET',
      url: '/account',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getAccountAfterRenew)
    expect(getAccountAfterRenew.result).toEqual(
      expect.stringContaining('Credential renewed')
    )

    // J4: revoke it
    fetchMock.mockResponseOnce(JSON.stringify(issuedCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getRevokeConfirm = await server.inject({
      method: 'GET',
      url: '/account/credentials/cred-journey-1/revoke',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getRevokeConfirm)
    expect(getRevokeConfirm.statusCode).toBe(statusCodes.ok)

    fetchMock.mockResponseOnce(null, { status: 204 })
    const postRevoke = await server.inject({
      method: 'POST',
      url: '/account/credentials/cred-journey-1/revoke',
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
    const getAccountAfterRevoke = await server.inject({
      method: 'GET',
      url: '/account',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getAccountAfterRevoke.result).toEqual(
      expect.stringContaining('Credential revoked')
    )
    expect(getAccountAfterRevoke.result).toEqual(
      expect.stringContaining('revoked')
    )
  })
})

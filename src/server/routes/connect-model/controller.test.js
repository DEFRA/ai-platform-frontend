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

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
}


describe('#connectModelController', () => {
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

  test('GET /connect-model redirects to /sign-in when signed out', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/connect-model'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/sign-in?returnTo=%2Fconnect-model')
  })

  test('POST /connect-model with no provider selected re-renders the form with errors', async () => {
    const cookies = await signIn(server)

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/connect-model',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('completes the connect-to-model journey end to end', async () => {
    let cookies = await signIn(server)

    const postChooseProvider = await server.inject({
      method: 'POST',
      url: '/connect-model',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, provider: 'openai' }
    })
    cookies = mergeCookies(cookies, postChooseProvider)

    expect(postChooseProvider.statusCode).toBe(303)
    expect(postChooseProvider.headers.location).toBe(
      '/connect-model/select-model'
    )

    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))
    const getSelectModel = await server.inject({
      method: 'GET',
      url: '/connect-model/select-model',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getSelectModel)

    expect(getSelectModel.statusCode).toBe(statusCodes.ok)
    expect(getSelectModel.result).toEqual(expect.stringContaining('GPT-4o'))

    const postSelectModel = await server.inject({
      method: 'POST',
      url: '/connect-model/select-model',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, modelSlug: 'gpt-4o' }
    })
    cookies = mergeCookies(cookies, postSelectModel)

    expect(postSelectModel.statusCode).toBe(303)
    expect(postSelectModel.headers.location).toBe('/connect-model/confirm')

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getConfirm = await server.inject({
      method: 'GET',
      url: '/connect-model/confirm',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getConfirm)

    expect(getConfirm.statusCode).toBe(statusCodes.ok)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        credential: {
          status: 'active',
          keyHint: 'ab12',
          expiresAt: '2026-09-23T00:00:00.000Z'
        },
        secret: 'mock_test_secret'
      })
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

    expect(getCredential.statusCode).toBe(statusCodes.ok)
    expect(getCredential.result).toEqual(
      expect.stringContaining('mock_test_secret')
    )

    // The secret is one-render only: requesting the page again redirects away.
    const getCredentialAgain = await server.inject({
      method: 'GET',
      url: '/connect-model/credential',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getCredentialAgain.statusCode).toBe(302)
    expect(getCredentialAgain.headers.location).toBe('/connect-model')
  })
})

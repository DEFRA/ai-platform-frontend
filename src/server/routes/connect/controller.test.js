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
  limitsDefault: { requestsPerMinute: 60, tokensPerDay: 100000 }
}

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
}

async function reachDetailsStep(server, cookies) {
  const startShared = await server.inject({
    method: 'GET',
    url: '/connect/shared/start',
    headers: { cookie: cookieHeader(cookies) }
  })
  cookies = mergeCookies(cookies, startShared)

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

  return cookies
}

async function reachCheckStep(server, cookies) {
  cookies = await reachDetailsStep(server, cookies)

  const postDetails = await server.inject({
    method: 'POST',
    url: '/connect/shared/details',
    headers: { cookie: cookieHeader(cookies) },
    payload: {
      crumb: cookies.crumb,
      purpose: 'Evaluating for a pilot',
      agreeToTerms: 'true'
    }
  })
  cookies = mergeCookies(cookies, postDetails)

  return cookies
}

describe('#connectController', () => {
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

  test('GET /connect/shared/details says a team client secret follows the last research renewal', async () => {
    let cookies = await signIn(server)
    cookies = await reachDetailsStep(server, cookies)

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/connect/shared/details',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain(
      'A key for using a model on your own comes with limits:'
    )
    expect(result).toContain(
      'you can renew it 3 times, then you need a team client secret'
    )
    expect(result).not.toContain('team key')
  })

  test('POST /connect/shared/details without accepting terms re-renders with an error and makes no API call', async () => {
    let cookies = await signIn(server)
    cookies = await reachDetailsStep(server, cookies)

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/connect/shared/details',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, purpose: 'Testing' }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/credentials'),
      expect.anything()
    )
  })

  test('completes the shared connect journey end to end', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getCheck = await server.inject({
      method: 'GET',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCheck)

    expect(getCheck.statusCode).toBe(statusCodes.ok)
    expect(getCheck.result).toEqual(
      expect.stringContaining('Evaluating for a pilot')
    )
    expect(getCheck.result).toEqual(
      expect.stringContaining('60 requests a minute')
    )
    expect(getCheck.result).toMatch(
      /Environment\s*<\/dt>\s*<dd[^>]*>\s*Development/
    )
    expect(getCheck.result).toMatch(
      /Access for\s*<\/dt>\s*<dd[^>]*>\s*Just me, on your own/
    )
    expect(getCheck.result).not.toMatch(/research/i)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        credential: {
          tier: 'research',
          environment: 'infradev',
          status: 'active',
          keyHint: 'ab12',
          expiresAt: '2026-09-23T00:00:00.000Z'
        },
        secret: 'mock_test_secret'
      })
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

    expect(getCredential.statusCode).toBe(statusCodes.ok)
    expect(getCredential.headers['cache-control']).toEqual(
      expect.stringContaining('no-store')
    )
    expect(getCredential.result).toEqual(
      expect.stringContaining('mock_test_secret')
    )
    expect(getCredential.result).toEqual(
      expect.stringContaining(
        'https://apim-aip-infradev.azure-api.net/research/openai/deployments/gpt-4o/chat/completions'
      )
    )
    expect(getCredential.result).toEqual(
      expect.stringContaining(', in Development')
    )
    expect(getCredential.result).not.toEqual(
      expect.stringContaining('deploytestdefra')
    )
    expect(getCredential.result).not.toEqual(
      expect.stringContaining('mock-gateway.ai-platform.defra.gov.uk')
    )
    expect(getCredential.result).toEqual(
      expect.stringContaining('api-version=2024-05-01-preview')
    )
    expect(getCredential.result).toEqual(
      expect.stringContaining('60 requests a minute')
    )
    expect(getCredential.result).not.toEqual(
      expect.stringContaining('undefined')
    )

    const getCredentialAgain = await server.inject({
      method: 'GET',
      url: '/connect/shared/credential',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(getCredentialAgain.statusCode).toBe(302)
    expect(getCredentialAgain.headers.location).toBe('/models')
  })

  test('POST /connect/shared/check shows a message and a manage link for an existing active credential (409)', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getCheck = await server.inject({
      method: 'GET',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        code: 'active-credential-exists',
        message: 'An active credential already exists for this model'
      }),
      { status: 409 }
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postCheck.statusCode).toBe(409)
    expect(postCheck.result).toEqual(
      expect.stringContaining('You already have an active credential')
    )
    expect(postCheck.result).toEqual(expect.stringContaining('/manage'))
  })

  test('POST /connect/shared/check shows a renew message and a manage link for an expired credential (409)', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getCheck = await server.inject({
      method: 'GET',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        code: 'credential-expired-use-renew',
        message:
          'Your credential for this model has expired. Renew it instead of requesting a new one.'
      }),
      { status: 409 }
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postCheck.statusCode).toBe(409)
    expect(postCheck.result).toEqual(
      expect.stringContaining('has expired. Renew it instead')
    )
    expect(postCheck.result).toEqual(expect.stringContaining('/manage'))
  })

  test('POST /connect/shared/check says a model that cannot be tried on your own is not available', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getCheck = await server.inject({
      method: 'GET',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        code: 'model-not-eligible',
        message: 'Model is not eligible'
      }),
      { status: 422 }
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postCheck.result).toEqual(
      expect.stringContaining('This model is not available to try on your own.')
    )
    expect(postCheck.result).not.toMatch(/research tier/i)
  })

  test('POST /connect/shared/check shows a safe error when the issuer fails (502)', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const getCheck = await server.inject({
      method: 'GET',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) }
    })
    cookies = mergeCookies(cookies, getCheck)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        code: 'upstream-unavailable',
        message: 'Failed to issue credential'
      }),
      { status: 502 }
    )
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const postCheck = await server.inject({
      method: 'POST',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postCheck.statusCode).toBe(502)
    expect(postCheck.result).toEqual(
      expect.stringContaining('We could not issue a credential')
    )
  })

  test('POST /connect/shared/check redirects to sign in if the session expired mid-journey', async () => {
    let cookies = await signIn(server)
    cookies = await reachCheckStep(server, cookies)

    const signOut = await server.inject({
      method: 'POST',
      url: '/sign-out',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })
    cookies = mergeCookies(cookies, signOut)

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/connect/shared/check',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe(
      '/sign-in?returnTo=%2Fconnect%2Fshared%2Fcheck'
    )
  })
})

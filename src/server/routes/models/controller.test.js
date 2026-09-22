import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
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
  family: 'gpt-4o',
  version: '2024-08-06',
  description: 'Multimodal OpenAI model.',
  contextWindow: '128,000 tokens',
  region: 'uksouth',
  dataZone: 'uk',
  eligible: true,
  tiers: ['research'],
  useCases: ['Chat assistants'],
  links: [{ text: 'Best practice guide', href: '/help/best-practice' }],
  deploymentName: 'gpt-4o',
  apiVersion: '2024-05-01-preview',
  endpoint: 'https://mock-gateway.ai-platform.defra.gov.uk/openai/gpt-4o',
  limits: { requestsPerMinute: 60 }
}

describe('#modelsController', () => {
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

  test('GET /models is public and lists models', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/models'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
  })

  test('GET /models forwards provider and tier filters to the backend', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    await server.inject({
      method: 'GET',
      url: '/models?provider=openai&tier=research'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/models?provider=openai&tier=research'),
      expect.anything()
    )
  })

  test('GET /models/{slug} shows a Connect button for an eligible model even when signed out', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/models/gpt-4o'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
    expect(result).toEqual(expect.stringContaining('/connect?modelSlug=gpt-4o'))
  })

  test('GET /models/{slug} shows a Connect button when eligible and signed in', async () => {
    const cookies = await signInViaOidc(server, fetchMock)

    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/models/gpt-4o',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('/connect?modelSlug=gpt-4o'))
  })

  test('GET /models/{slug} shows "Not approved" for an ineligible model even when signed out', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleModel, eligible: false })
    )
    const { result } = await server.inject({
      method: 'GET',
      url: '/models/gpt-4o'
    })

    expect(result).toEqual(
      expect.stringContaining('Not approved for the research tier')
    )
  })

  test('GET /models/{slug} returns 404 for an unknown slug', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 404,
        error: 'Not Found',
        code: 'not-found'
      }),
      { status: 404 }
    )

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/models/does-not-exist'
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toEqual(expect.stringContaining('Model not found'))
  })
})

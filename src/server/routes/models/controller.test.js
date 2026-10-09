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
  limits: { requestsPerMinute: 60 },
  limitsDefault: { requestsPerMinute: 60, tokensPerDay: 100000 }
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

  test('GET /models asks the backend to include ineligible models, so they can be greyed out', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    await server.inject({ method: 'GET', url: '/models' })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('includeIneligible=true'),
      expect.anything()
    )
  })

  test('GET /models shows a backend-ineligible model greyed out with its reason', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            ...sampleModel,
            eligible: false,
            eligibilityReason: 'Not yet approved for general use.'
          }
        ]
      })
    )

    const { result } = await server.inject({ method: 'GET', url: '/models' })

    expect(result).toEqual(
      expect.stringContaining('app-model-table__row--disabled')
    )
    expect(result).toEqual(
      expect.stringContaining('Not yet approved for general use.')
    )
  })

  test('GET /models?tier=team shows a team-only model as eligible', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [{ ...sampleModel, tiers: ['team'] }]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/models?tier=team'
    })

    expect(result).not.toEqual(
      expect.stringContaining('app-model-table__row--disabled')
    )
  })

  test('GET /models?tier=team marks a research-only model as ineligible', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [{ ...sampleModel, tiers: ['research'] }]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/models?tier=team'
    })

    expect(result).toEqual(
      expect.stringContaining('app-model-table__row--disabled')
    )
  })

  test('GET /models with no tier filter accepts either offered tier', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          { ...sampleModel, slug: 'team-only', tiers: ['team'] },
          { ...sampleModel, slug: 'research-only', tiers: ['research'] }
        ]
      })
    )

    const { result } = await server.inject({ method: 'GET', url: '/models' })

    expect(result).not.toEqual(
      expect.stringContaining('app-model-table__row--disabled')
    )
  })

  test('GET /models marks a model offering no approved tier as ineligible', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [{ ...sampleModel, tiers: ['enterprise'] }]
      })
    )

    const { result } = await server.inject({ method: 'GET', url: '/models' })

    expect(result).toEqual(
      expect.stringContaining('app-model-table__row--disabled')
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

  test('GET /models/{slug} shows requests per minute and tokens per day instead of context window', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { result } = await server.inject({
      method: 'GET',
      url: '/models/gpt-4o'
    })

    expect(result).toEqual(expect.stringContaining('Requests per minute'))
    expect(result).toEqual(expect.stringContaining('Tokens per day'))
    expect(result).toEqual(expect.stringContaining('100000'))
    expect(result).not.toEqual(expect.stringContaining('Context window'))
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

    expect(result).toEqual(expect.stringContaining('Not approved for use yet'))
  })

  test('GET /models/{slug} shows the real gateway request, not the mock endpoint field', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleModel, apiProfile: 'chat-completions' })
    )
    const { result } = await server.inject({
      method: 'GET',
      url: '/models/gpt-4o'
    })

    expect(result).toEqual(
      expect.stringContaining(
        '/research/openai/deployments/gpt-4o/chat/completions'
      )
    )
    expect(result).not.toEqual(
      expect.stringContaining('mock-gateway.ai-platform.defra.gov.uk')
    )
  })

  test('GET /models/{slug} names the provider as host for a direct offering and shows only its data zone', async () => {
    const { region, ...regionless } = sampleModel
    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...regionless,
        provider: 'meta',
        hosting: { platform: 'direct', cloud: null, provider: 'meta' }
      })
    )
    const { result } = await server.inject({
      method: 'GET',
      url: '/models/gpt-4o'
    })

    expect(result).toEqual(expect.stringContaining('Meta, hosted by Meta'))
    expect(result).not.toEqual(expect.stringContaining('hosted by Defra'))
    expect(result).toEqual(expect.stringContaining('UK data zone'))
    expect(result).not.toEqual(expect.stringContaining('UK South data zone'))
    expect(result).not.toEqual(expect.stringContaining('undefined'))
  })

  test('GET /models/{slug} keeps the "hosted by Defra in {region}" caption for a foundry model', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...sampleModel,
        hosting: { platform: 'foundry', cloud: 'azure', provider: null }
      })
    )
    const { result } = await server.inject({
      method: 'GET',
      url: '/models/gpt-4o'
    })

    expect(result).toEqual(
      expect.stringContaining('OpenAI, hosted by Defra in UK South')
    )
    expect(result).toEqual(expect.stringContaining('UK South, UK data zone'))
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

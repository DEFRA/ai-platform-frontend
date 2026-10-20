import { config } from '#/config/config.js'
import { buildGatewayRequest } from '#/server/common/helpers/gateway-request.js'

const sandboxHost = 'https://deploytestdefra.azure-api.net'
const infradevHost = 'https://apim-aip-infradev.azure-api.net'

describe('#buildGatewayRequest', () => {
  const originalBaseUrls = config.get('gateway.baseUrls')

  afterEach(() => {
    config.set('gateway.baseUrls', originalBaseUrls)
  })

  test('builds the chat-completions shape for a chat-completions model', () => {
    const { endpoint, requestBody } = buildGatewayRequest(
      {
        apiProfile: 'chat-completions',
        deploymentName: 'gpt-4o',
        apiVersion: '2024-05-01-preview'
      },
      'sandbox'
    )

    expect(endpoint).toBe(
      `${sandboxHost}/research/openai/deployments/gpt-4o/chat/completions?api-version=2024-05-01-preview`
    )
    expect(requestBody).toEqual({
      messages: [{ role: 'user', content: 'Hello' }]
    })
  })

  test('builds the responses shape, with the model as a body field', () => {
    const { endpoint, requestBody } = buildGatewayRequest(
      {
        apiProfile: 'responses',
        deploymentName: 'gpt-5-mini',
        apiVersion: '2025-03-01-preview'
      },
      'sandbox'
    )

    expect(endpoint).toBe(
      `${sandboxHost}/research/openai/responses?api-version=2025-03-01-preview`
    )
    expect(requestBody).toEqual({ model: 'gpt-5-mini', input: 'Hello' })
  })

  test('falls back to the chat-completions shape for an unrecognised apiProfile', () => {
    const { endpoint } = buildGatewayRequest(
      {
        apiProfile: 'embeddings',
        deploymentName: 'text-embedding-ada-002',
        apiVersion: '2024-05-01-preview'
      },
      'sandbox'
    )

    expect(endpoint).toEqual(expect.stringContaining('/chat/completions?'))
  })

  test('uses the gateway of the environment asked for and the same request shape in each', () => {
    const model = {
      apiProfile: 'chat-completions',
      deploymentName: 'gpt-4o',
      apiVersion: '2024-05-01-preview'
    }

    const infradev = buildGatewayRequest(model, 'infradev')
    const sandbox = buildGatewayRequest(model, 'sandbox')

    expect(infradev.endpoint).toBe(
      `${infradevHost}/research/openai/deployments/gpt-4o/chat/completions?api-version=2024-05-01-preview`
    )
    expect(infradev.endpoint.replace(infradevHost, '')).toBe(
      sandbox.endpoint.replace(sandboxHost, '')
    )
    expect(infradev.requestBody).toEqual(sandbox.requestBody)
  })

  test('follows the configured gateway URLs', () => {
    config.set('gateway.baseUrls', { infradev: 'https://gateway.test' })

    const { endpoint } = buildGatewayRequest(
      {
        apiProfile: 'responses',
        deploymentName: 'gpt-4o',
        apiVersion: '2025-03-01-preview'
      },
      'infradev'
    )

    expect(endpoint).toBe(
      'https://gateway.test/research/openai/responses?api-version=2025-03-01-preview'
    )
  })

  test.each([undefined, 'made-up', 'constructor'])(
    'shows a placeholder host rather than a made-up one for environment %s',
    (environment) => {
      config.set('gateway.baseUrls', { infradev: 'https://gateway.test' })

      const { endpoint } = buildGatewayRequest(
        { deploymentName: 'gpt-4o', apiVersion: '2024-05-01-preview' },
        environment
      )

      expect(endpoint).toMatch(/^https:\/\/<gateway-host>\/research\//)
    }
  )
})

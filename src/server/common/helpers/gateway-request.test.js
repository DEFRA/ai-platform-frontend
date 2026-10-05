import { buildGatewayRequest } from '#/server/common/helpers/gateway-request.js'

describe('#buildGatewayRequest', () => {
  test('builds the chat-completions shape for a chat-completions model', () => {
    const { endpoint, requestBody } = buildGatewayRequest({
      apiProfile: 'chat-completions',
      deploymentName: 'gpt-4o',
      apiVersion: '2024-05-01-preview'
    })

    expect(endpoint).toBe(
      'https://deploytestdefra.azure-api.net/research/openai/deployments/gpt-4o/chat/completions?api-version=2024-05-01-preview'
    )
    expect(requestBody).toEqual({
      messages: [{ role: 'user', content: 'Hello' }]
    })
  })

  test('builds the responses shape, with the model as a body field', () => {
    const { endpoint, requestBody } = buildGatewayRequest({
      apiProfile: 'responses',
      deploymentName: 'gpt-5-mini',
      apiVersion: '2025-03-01-preview'
    })

    expect(endpoint).toBe(
      'https://deploytestdefra.azure-api.net/research/openai/responses?api-version=2025-03-01-preview'
    )
    expect(requestBody).toEqual({ model: 'gpt-5-mini', input: 'Hello' })
  })

  test('falls back to the chat-completions shape for an unrecognised apiProfile', () => {
    const { endpoint } = buildGatewayRequest({
      apiProfile: 'embeddings',
      deploymentName: 'text-embedding-ada-002',
      apiVersion: '2024-05-01-preview'
    })

    expect(endpoint).toEqual(expect.stringContaining('/chat/completions?'))
  })
})

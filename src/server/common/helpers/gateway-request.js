import { config } from '#/config/config.js'

const gatewayBaseUrl = config.get('gateway.baseUrl')
const researchApiId = config.get('gateway.researchApiId')

const SAMPLE_PROMPT = 'Hello'

/**
 * Builds the real APIM gateway request for a model, keyed off `apiProfile`
 * (design: "snippets and tabs follow apiProfile") - shapes verified against
 * the sandbox gateway (see docs/plans/integration/research-tier-integration-plan.md).
 * `responses` takes the model as a body field with no deployment segment in
 * the URL; every other profile (including `chat-completions`) uses the
 * deployment-scoped chat completions shape.
 * @param {{apiProfile?: string, deploymentName: string, apiVersion: string}} model
 * @returns {{endpoint: string, requestBody: object}}
 */
export function buildGatewayRequest(model) {
  if (model.apiProfile === 'responses') {
    return {
      endpoint: `${gatewayBaseUrl}/${researchApiId}/openai/responses?api-version=${model.apiVersion}`,
      requestBody: { model: model.deploymentName, input: SAMPLE_PROMPT }
    }
  }

  return {
    endpoint: `${gatewayBaseUrl}/${researchApiId}/openai/deployments/${model.deploymentName}/chat/completions?api-version=${model.apiVersion}`,
    requestBody: { messages: [{ role: 'user', content: SAMPLE_PROMPT }] }
  }
}

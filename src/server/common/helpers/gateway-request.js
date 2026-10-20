import { config } from '#/config/config.js'

const researchApiId = config.get('gateway.researchApiId')

const SAMPLE_PROMPT = 'Hello'

// An environment with no configured gateway (a key issued somewhere this
// instance no longer knows) must not be shown a host that is not its own.
const UNKNOWN_GATEWAY_HOST = 'https://<gateway-host>'

/**
 * Builds the real APIM gateway request for a model in an environment, keyed
 * off `apiProfile` (design: "snippets and tabs follow apiProfile"). The
 * research path is the official Azure OpenAI spec's, passed straight
 * through: the URL carries the deployment name exactly as Azure holds it, in
 * every environment, and only the host changes.
 * `responses` takes the model as a body field with no deployment segment in
 * the URL; every other profile (including `chat-completions`) uses the
 * deployment-scoped chat completions shape.
 * @param {{apiProfile?: string, deploymentName: string, apiVersion: string}} model
 * @param {string} environment - the environment code the key works in
 * @returns {{endpoint: string, requestBody: object}}
 */
export function buildGatewayRequest(model, environment) {
  const baseUrls = config.get('gateway.baseUrls')
  const gatewayBaseUrl = Object.hasOwn(baseUrls, environment)
    ? baseUrls[environment]
    : UNKNOWN_GATEWAY_HOST

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

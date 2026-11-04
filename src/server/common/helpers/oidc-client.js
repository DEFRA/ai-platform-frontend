import * as client from 'openid-client'

import { config } from '#/config/config.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

let discoveryPromise
let assertionProvider
let currentAssertion

const isFederated = () => config.get('azureAd.authMethod') === 'federated'

// The one way this frontend proves itself to Entra when it federates (design
// E #portal): a client assertion, the CDP Web Identity token, sent with the
// code, refresh and client-credentials grants alike. The library's hook is
// synchronous, so the assertion is fetched by getOidcConfig({ authenticateClient: true }) just before a
// grant and read here.
function federatedClientAuthentication(_server, clientMetadata, body) {
  body.set('client_id', clientMetadata.client_id)
  body.set('client_assertion_type', CLIENT_ASSERTION_TYPE)
  body.set('client_assertion', currentAssertion)
}

// Loaded only when federating: it brings the AWS client, which a developer's
// machine (client-secret) never needs.
async function refreshClientAssertion() {
  if (!assertionProvider) {
    const { WebIdentityTokenProvider } = await import('@defra/hapi-auth-oidc')

    assertionProvider = new WebIdentityTokenProvider({
      audience: [config.get('azureAd.federatedAudience')]
    })
  }

  // The provider keeps the token until it nears its expiry, so this is cheap.
  const assertion = await assertionProvider.getCredentials(createLogger())

  if (!assertion) {
    throw new Error('CDP Web Identity gave no client assertion')
  }

  currentAssertion = assertion
}

function discover() {
  const tenantId = config.get('azureAd.tenantId')
  const clientId = config.get('azureAd.clientId')

  if (!tenantId || !clientId || !config.get('azureAd.apiClientId')) {
    return Promise.reject(
      new Error(
        'Entra ID sign-in is not configured (set AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_API_CLIENT_ID)'
      )
    )
  }

  // Federated: no secret is read. Client secret: localhost only (config.js).
  const clientSecret = isFederated()
    ? undefined
    : config.get('azureAd.clientSecret')
  const clientAuthentication = isFederated()
    ? federatedClientAuthentication
    : undefined

  // Dev-only: point at a local mock OIDC provider instead of Entra ID so the
  // sign-in journey can be tested without a real Azure AD tenant. Never
  // honoured in production, regardless of what's set in the environment.
  // allowInsecureRequests is required since the mock provider runs over http.
  const mockIssuerUrl = config.get('azureAd.mockIssuerUrl')
  if (mockIssuerUrl && !config.get('isProduction')) {
    return client.discovery(
      new URL(mockIssuerUrl),
      clientId,
      clientSecret,
      clientAuthentication,
      { execute: [client.allowInsecureRequests] }
    )
  }

  const issuer = new URL(`https://login.microsoftonline.com/${tenantId}/v2.0`)

  return client.discovery(issuer, clientId, clientSecret, clientAuthentication)
}

/**
 * The Entra ID OIDC configuration, discovered once and cached. Pass
 * `{ authenticateClient: true }` before a grant (code, refresh or client
 * credentials): when federating, the client assertion is then refreshed, so
 * the grant is authenticated. The sign-in and end-session addresses are not
 * grants and need no assertion, so sign-out still ends the Entra session when
 * CDP Web Identity is failing.
 * @param {{ authenticateClient?: boolean }} [options]
 */
export async function getOidcConfig({ authenticateClient = false } = {}) {
  if (!discoveryPromise) {
    // A failed discovery is not kept: the next request tries again.
    discoveryPromise = discover().catch((error) => {
      discoveryPromise = undefined
      throw error
    })
  }

  const oidcConfig = await discoveryPromise

  if (authenticateClient && isFederated()) {
    await refreshClientAssertion()
  }

  return oidcConfig
}

/**
 * Test-only: clears the memoized discovery and assertion so config changes take effect.
 */
export function resetOidcConfig() {
  discoveryPromise = undefined
  assertionProvider = undefined
  currentAssertion = undefined
}

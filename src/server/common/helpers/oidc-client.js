import * as client from 'openid-client'

import { config } from '#/config/config.js'

let discoveryPromise

function discover() {
  const tenantId = config.get('azureAd.tenantId')
  const clientId = config.get('azureAd.clientId')
  const clientSecret = config.get('azureAd.clientSecret')

  if (!tenantId || !clientId) {
    return Promise.reject(
      new Error(
        'Entra ID sign-in is not configured (set AZURE_TENANT_ID and AZURE_CLIENT_ID)'
      )
    )
  }

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
      undefined,
      { execute: [client.allowInsecureRequests] }
    )
  }

  const issuer = new URL(`https://login.microsoftonline.com/${tenantId}/v2.0`)

  return client.discovery(issuer, clientId, clientSecret)
}

/**
 * Lazily discovers and caches the Entra ID OIDC authorization server configuration.
 */
export function getOidcConfig() {
  if (!discoveryPromise) {
    discoveryPromise = discover()
  }

  return discoveryPromise
}

/**
 * Test-only: clears the memoized discovery so config changes take effect.
 */
export function resetOidcConfig() {
  discoveryPromise = undefined
}

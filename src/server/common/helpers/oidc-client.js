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

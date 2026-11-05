import { config } from '#/config/config.js'

/**
 * The scopes a person signs in with: the OpenID scopes, `offline_access` so
 * the session can refresh, and the API's `Portal.Access` (design E #portal).
 * @returns {string}
 */
export function userScope() {
  return `openid profile email offline_access api://${config.get('azureAd.apiClientId')}/Portal.Access`
}

/**
 * The scope for the frontend's own client-credentials token: everything the
 * API registration grants the application, which is no role in the first build.
 * @returns {string}
 */
export function appScope() {
  return `api://${config.get('azureAd.apiClientId')}/.default`
}

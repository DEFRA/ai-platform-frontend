// The issuer key the backend stamps on a credential its mock issuer made.
const MOCK_ISSUER_KEY = 'mock'

/**
 * Whether a credential is a team client secret made by the mock issuer: it
 * is shown but will not work against the gateway. Removed when Phase 5 B18's
 * real issuer lands.
 * @param {{tier?: string, issuerKey?: string}|null|undefined} credential
 * @returns {boolean}
 */
export function isPlaceholderCredential(credential) {
  return credential?.tier === 'team' && credential.issuerKey === MOCK_ISSUER_KEY
}

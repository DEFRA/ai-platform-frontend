import { config } from '#/config/config.js'
import { isEligible } from './eligibility-rule.js'

// The issuer of an account's tenant as the `idp` claim gives it: the v1.0
// STS address, or the v2.0 login address, with the tenant ID in it.
const TENANT_ISSUER =
  /^https:\/\/(?:sts\.windows\.net|login\.microsoftonline\.com)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i

/**
 * @returns {string[]} The email domains that may sign in, in lower case, from
 * the comma-separated `allowedEmailDomains` setting.
 */
export function allowedEmailDomains() {
  return config
    .get('allowedEmailDomains')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

function absent(value) {
  return value === undefined || value === null
}

/**
 * Whether the identity provider that signed the person in is this tenant.
 * Microsoft: `idp` "is identical to the value of the issuer claim unless the
 * user account isn't in the same tenant as the issuer - guests, for
 * instance", and its tenant is the home tenant (or `live.com` and other
 * providers, which have none). A guest's `tid` is the resource tenant, so an
 * `idp` for a tenant other than `tid` is a guest. No `idp` means `iss` is the
 * provider, which is this tenant.
 * @param {Record<string, unknown>} claims
 * @returns {boolean}
 */
function signedInByThisTenant({ idp, iss, tid }) {
  if (absent(idp) || idp === iss) {
    return true
  }

  const tenant = typeof idp === 'string' ? TENANT_ISSUER.exec(idp)?.[1] : null

  return (
    typeof tid === 'string' &&
    typeof tenant === 'string' &&
    tenant.toLowerCase() === tid.toLowerCase()
  )
}

/**
 * Whether the claims say the account is a guest of the tenant, by the two
 * claims Microsoft documents for it: `idp` (see above), which needs no app
 * registration change, and `acct` when the registration asks for it (0 is a
 * member, 1 a guest; anything but 0 is refused). A guest's `#EXT#` name is
 * refused by the address rule.
 * @param {Record<string, unknown>} claims
 * @returns {boolean}
 */
function isGuest(claims) {
  const guestByAccountStatus = !absent(claims.acct) && `${claims.acct}` !== '0'

  return guestByAccountStatus || !signedInByThisTenant(claims)
}

/**
 * Whether an account may sign in (design: eligible accounts are on one of the
 * allowed domains, an exact match with no regard to case, and never a guest).
 * It decides on the claims of the ID token, the only place they are seen, so
 * it is the only place a guest can be told from a member; the backend then
 * applies the address rule to the address it is sent.
 *
 * The domain is decided on the person's own sign-in name (`preferred_username`,
 * else `upn`) and, when they have them, the `email` claim and the `upn`: all
 * must be eligible (Microsoft says `email` is not for authorisation, so it can
 * only refuse, never admit).
 * @param {Record<string, unknown>} claims - The ID token claims.
 * @returns {boolean}
 */
export function isEligibleAccount(claims) {
  if (isGuest(claims)) {
    return false
  }

  const domains = allowedEmailDomains()
  const { email, upn } = claims
  const name = claims.preferred_username ?? upn

  return (
    isEligible({ userPrincipalName: name, mail: email }, domains) &&
    (absent(upn) || isEligible({ userPrincipalName: upn }, domains))
  )
}

/**
 * The address to send to the backend, and to show: the email when there is
 * one, else the sign-in name.
 * @param {Record<string, unknown>} claims - The ID token claims.
 * @returns {string|undefined}
 */
export function signInAddress(claims) {
  const email = typeof claims.email === 'string' ? claims.email.trim() : ''

  return email || (claims.preferred_username ?? claims.upn)
}

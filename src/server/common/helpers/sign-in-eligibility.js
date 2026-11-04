import { config } from '#/config/config.js'

// Marks a guest in the user name Entra ID gives, as in
// `sam_gmail.com#EXT#@defra.onmicrosoft.com`.
const GUEST_MARKER = '#ext#'

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

function isGuest(name) {
  return typeof name === 'string' && name.toLowerCase().includes(GUEST_MARKER)
}

// The domain of an address with one user name and one domain, as is.
function domainOf(address) {
  if (typeof address !== 'string') {
    return undefined
  }

  const parts = address.split('@')
  const [name, domain] = parts

  return parts.length === 2 && name && domain ? domain.toLowerCase() : undefined
}

/**
 * Whether an account may sign in (design: eligible accounts are on one of the
 * allowed domains, an exact match with no regard to case, and never a
 * `#EXT#` guest). It is a gate on who reaches the backend, which makes the
 * same decision for itself.
 * @param {{email?: unknown, preferredUsername?: unknown}} account - The
 * address the person is known by, and the user name Entra ID gives them.
 * @returns {boolean}
 */
export function isEligibleAccount({ email, preferredUsername }) {
  if (isGuest(email) || isGuest(preferredUsername)) {
    return false
  }

  const domain = domainOf(email ?? preferredUsername)

  return domain !== undefined && allowedEmailDomains().includes(domain)
}

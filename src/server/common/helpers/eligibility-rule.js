// The rule for who is eligible, by address. It is the same rule as the
// backend's `isEligible` (ai-platform-backend-api
// `src/services/directory-eligibility.js`), and both run the same test table:
// change one, change the other.

const GUEST_MARKER = '#ext#'

/**
 * The domain of an address that has exactly one `@` and a local part, lower
 * case; null for anything else (so a guest UPN such as
 * `name_example.com#EXT#@tenant.onmicrosoft.com` is judged by its whole shape,
 * not by the text after the last `@` alone).
 * @param {unknown} address
 * @returns {string|null}
 */
function domainOf(address) {
  if (typeof address !== 'string') {
    return null
  }

  const lower = address.trim().toLowerCase()
  const parts = lower.split('@')

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null
  }

  return lower.includes(GUEST_MARKER) ? null : parts[1]
}

/**
 * The person's mail as an address, or null when they have none: a blank or
 * whitespace-only mail is no mail. Anything that is not text is returned as it
 * is, so it fails the domain check and is never mistaken for absent.
 * @param {{mail?: unknown}} person
 * @returns {unknown}
 */
function mailOf(person) {
  const { mail } = person

  return typeof mail === 'string' ? mail.trim() || null : (mail ?? null)
}

/**
 * Whether a person is eligible: a name (a user principal name, or the user
 * name a sign-in gives) and, when they have one, a mail, each on an allowed
 * domain. The domain must match exactly, so a subdomain or look-alike is
 * refused, and so is any `#EXT#` guest address (design F, DF:51).
 * @param {{userPrincipalName?: unknown, mail?: unknown}|null|undefined} person
 * @param {string[]} allowedDomains
 * @returns {boolean}
 */
export function isEligible(person, allowedDomains) {
  const domains = new Set(
    allowedDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean)
  )
  const upnDomain = domainOf(person?.userPrincipalName)

  if (!upnDomain || !domains.has(upnDomain)) {
    return false
  }

  const mail = mailOf(person)

  if (mail === null) {
    return true
  }

  const mailDomain = domainOf(mail)

  return mailDomain !== null && domains.has(mailDomain)
}

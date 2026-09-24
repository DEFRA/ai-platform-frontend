const INTERNAL_BASE = 'https://internal.invalid'

/**
 * Narrows a user-supplied `returnTo` to a same-origin path, guarding against
 * open redirects (OWASP A01). Absolute URLs (`https://evil.example`),
 * protocol-relative (`//evil.example`) and backslash-escaped (`/\evil.example`)
 * forms all resolve to a different origin and fall back instead.
 * @param {string} [value] the untrusted candidate path
 * @param {string} [fallback] path returned when `value` is missing or unsafe
 * @returns {string} a safe, same-origin path
 */
export function safeReturnTo(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return fallback
  }

  try {
    const url = new URL(value, INTERNAL_BASE)

    if (url.origin !== INTERNAL_BASE) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

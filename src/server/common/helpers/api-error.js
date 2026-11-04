/**
 * Error thrown for any non-2xx response from the backend API, carrying its stable `code`
 * plus any extra context fields the backend attached (e.g. `existingId` on a 409).
 * Also thrown by access-token.js when no token can be had for a call.
 */
export class ApiError extends Error {
  constructor({ statusCode, code, message, ...extra }) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    Object.assign(this, extra)
  }
}

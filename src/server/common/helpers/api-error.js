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

/**
 * Notes on the request that the backend (or the lack of a token) said this
 * session is no good. A page that reads with `Promise.allSettled` swallows the
 * error that said so, so `catchAll` reads this note too and ends the session
 * whatever the page went on to render.
 * @param {{ app?: object }} request
 */
export function markUnauthorised(request) {
  if (request?.app) {
    request.app.unauthorised = true
  }
}

/**
 * Whether a call on this request was refused as unauthorised.
 * @param {{ app?: { unauthorised?: boolean } }} request
 * @returns {boolean}
 */
export function wasUnauthorised(request) {
  return request?.app?.unauthorised === true
}

import { getSessionUser } from './session.js'

/**
 * Pre-handler redirecting signed-out users to /sign-in, preserving the original
 * path and query (for example the model a "Try it" link named).
 */
export function requireSignIn(request, h) {
  if (!getSessionUser(request)) {
    const returnTo = `${request.path}${request.url?.search ?? ''}`

    return h
      .redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`)
      .takeover()
  }

  return h.continue
}

import { getSessionUser } from './session.js'

/**
 * Pre-handler redirecting signed-out users to /sign-in, preserving the original path.
 */
export function requireSignIn(request, h) {
  if (!getSessionUser(request)) {
    return h
      .redirect(`/sign-in?returnTo=${encodeURIComponent(request.path)}`)
      .takeover()
  }

  return h.continue
}

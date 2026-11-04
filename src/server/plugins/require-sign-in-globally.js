import { config } from '#/config/config.js'
import { requireSignIn } from '#/server/common/helpers/require-sign-in.js'
import {
  getSessionUser,
  resetSession
} from '#/server/common/helpers/session.js'
import {
  sessionEndReason,
  touchSession
} from '#/server/common/helpers/session-lifetime.js'

const publicPathPrefixes = [config.get('assetPath'), '/favicon.ico']

function isStaticFile(request) {
  return publicPathPrefixes.some((prefix) => request.path.startsWith(prefix))
}

// Where the person lands when the session has ended on its own. Only a GET
// names the page to come back to: a POST has no page to return to.
function signedOutRedirect(request, h, reason) {
  const query = new URLSearchParams({ reason })

  if (request.method === 'get') {
    query.set('returnTo', `${request.path}${request.url?.search ?? ''}`)
  }

  return h.redirect(`/signed-out?${query}`).takeover()
}

/**
 * Denies every route by default unless signed in; a route opts out by
 * setting `options: { app: { public: true } }`. Static assets are exempted
 * by path prefix so the sign-in page and its own CSS/JS can still load.
 *
 * It also enforces the session limits (design E #portal): a signed-in session
 * ends after 30 minutes without a request or 8 hours after sign-in. Every
 * request restarts the idle time, except a route that sets
 * `options: { app: { keepsIdleTime: true } }` (asking how long is left must
 * not add to it). An ended session is cleared; a protected route then sends
 * the person to the signed-out page, a public one shows them signed out.
 */
export const requireSignInGlobally = {
  plugin: {
    name: 'require-sign-in-globally',
    register(server) {
      server.ext('onPreHandler', (request, h) => {
        const isPublicRoute = request.route.settings.app?.public === true

        if (isStaticFile(request)) {
          return h.continue
        }

        if (getSessionUser(request)) {
          const reason = sessionEndReason(request)

          if (reason) {
            resetSession(request)

            return isPublicRoute
              ? h.continue
              : signedOutRedirect(request, h, reason)
          }

          if (request.route.settings.app?.keepsIdleTime !== true) {
            touchSession(request)
          }
        }

        return isPublicRoute ? h.continue : requireSignIn(request, h)
      })
    }
  }
}

/**
 * Response extension, registered in server.js after the error page is built so
 * it covers that too: a signed-in page is never kept by the browser or a
 * shared cache, so Back after sign-out cannot show it again. Static files stay
 * cacheable.
 */
export function noStoreWhenSignedIn(request, h) {
  const { response } = request

  if (!isStaticFile(request) && !response.isBoom && getSessionUser(request)) {
    response.header('cache-control', 'no-store')
  }

  return h.continue
}

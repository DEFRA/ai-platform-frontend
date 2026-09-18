import { config } from '#/config/config.js'
import { requireSignIn } from '#/server/common/helpers/require-sign-in.js'

const publicPathPrefixes = [config.get('assetPath'), '/favicon.ico']

/**
 * Denies every route by default unless signed in; a route opts out by
 * setting `options: { app: { public: true } }`. Static assets are exempted
 * by path prefix so the sign-in page and its own CSS/JS can still load.
 */
export const requireSignInGlobally = {
  plugin: {
    name: 'require-sign-in-globally',
    register(server) {
      server.ext('onPreHandler', (request, h) => {
        const isPublicAsset = publicPathPrefixes.some((prefix) =>
          request.path.startsWith(prefix)
        )
        const isPublicRoute = request.route.settings.app?.public === true

        if (isPublicAsset || isPublicRoute) {
          return h.continue
        }

        return requireSignIn(request, h)
      })
    }
  }
}

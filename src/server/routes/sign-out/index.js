import { signOutController } from './controller.js'

/**
 * Sets up the /sign-out route. Registered in src/server/plugins/router.js.
 */
export const signOut = {
  plugin: {
    name: 'sign-out',
    register(server) {
      server.route([
        {
          method: 'POST',
          path: '/sign-out',
          // Public: nav shows "Sign out" as soon as Entra login succeeds (see
          // build-navigation.js), before requireSignInGlobally's session-user
          // check would otherwise pass - without this, it silently bounces
          // through /sign-in instead of running the sign-out handler.
          options: { app: { public: true } },
          ...signOutController
        }
      ])
    }
  }
}

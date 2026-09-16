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
          ...signOutController
        }
      ])
    }
  }
}

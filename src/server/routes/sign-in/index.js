import { signInController } from './controller.js'

/**
 * Sets up the routes used in the self-declared sign-in journey (J1).
 * These routes are registered in src/server/plugins/router.js.
 */
export const signIn = {
  plugin: {
    name: 'sign-in',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/sign-in',
          ...signInController.get
        },
        {
          method: 'POST',
          path: '/sign-in',
          ...signInController.post
        }
      ])
    }
  }
}

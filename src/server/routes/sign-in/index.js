import { signInController } from './controller.js'

const publicRoute = { app: { public: true } }

/**
 * Sets up the single sign-in journey: /sign-in triggers Entra ID OIDC login,
 * which upserts the user and signs them in directly on /auth/callback.
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
          options: {
            ...publicRoute,
            validate: signInController.get.options.validate
          },
          handler: signInController.get.handler
        }
      ])
    }
  }
}

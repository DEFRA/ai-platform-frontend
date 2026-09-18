import { authController } from './controller.js'

const publicRoute = { app: { public: true } }

/**
 * Sets up the Entra ID (Azure AD) OIDC sign-in routes (phase 1b of J1).
 * These routes are registered in src/server/plugins/router.js.
 */
export const auth = {
  plugin: {
    name: 'auth',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/auth/login',
          options: publicRoute,
          ...authController.login
        },
        {
          method: 'GET',
          path: '/auth/callback',
          options: publicRoute,
          ...authController.callback
        }
      ])
    }
  }
}

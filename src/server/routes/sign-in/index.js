import { signInController } from './controller.js'

const publicRoute = { app: { public: true } }

/**
 * Sets up the single sign-in journey: /sign-in triggers Entra ID OIDC login,
 * and /sign-in/team collects a team name once Entra login succeeds.
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
          options: publicRoute,
          ...signInController.get
        },
        {
          method: 'GET',
          path: '/sign-in/team',
          options: publicRoute,
          ...signInController.team.get
        },
        {
          method: 'POST',
          path: '/sign-in/team',
          options: { ...publicRoute, ...signInController.team.post.options },
          handler: signInController.team.post.handler
        }
      ])
    }
  }
}

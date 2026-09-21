import { accountController } from './controller.js'

/**
 * Sets up the routes used in the manage-credentials journey (J4).
 * Protected by the global sign-in gate (src/server/plugins/require-sign-in-globally.js).
 * These routes are registered in src/server/plugins/router.js.
 */
export const account = {
  plugin: {
    name: 'account',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/account',
          handler: accountController.list.get.handler
        },
        {
          method: 'POST',
          path: '/account/credentials/{id}/renew',
          handler: accountController.renew.post.handler
        },
        {
          method: 'GET',
          path: '/account/credentials/{id}/revoke',
          handler: accountController.revoke.get.handler
        },
        {
          method: 'POST',
          path: '/account/credentials/{id}/revoke',
          options: {
            validate: accountController.revoke.post.options.validate
          },
          handler: accountController.revoke.post.handler
        }
      ])
    }
  }
}

import { manageController } from './controller.js'

/**
 * Sets up the routes used in the manage-credentials journey (B07).
 * Protected by the global sign-in gate (src/server/plugins/require-sign-in-globally.js).
 * These routes are registered in src/server/plugins/router.js.
 */
export const manage = {
  plugin: {
    name: 'manage',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/manage',
          handler: manageController.list.get.handler
        },
        {
          method: 'POST',
          path: '/manage/credentials/{id}/renew',
          handler: manageController.renew.post.handler
        },
        {
          method: 'GET',
          path: '/manage/credentials/{id}/revoke',
          handler: manageController.revoke.get.handler
        },
        {
          method: 'POST',
          path: '/manage/credentials/{id}/revoke',
          options: {
            validate: manageController.revoke.post.options.validate
          },
          handler: manageController.revoke.post.handler
        }
      ])
    }
  }
}

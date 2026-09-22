import { modelsController } from './controller.js'

const publicRoute = { app: { public: true } }

/**
 * Sets up the public model catalogue routes (B04): list and detail pages.
 * Public: not gated by requireSignInGlobally, since anyone can browse models.
 * These routes are registered in src/server/plugins/router.js.
 */
export const models = {
  plugin: {
    name: 'models',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/models',
          options: {
            ...publicRoute,
            validate: modelsController.list.get.options.validate
          },
          handler: modelsController.list.get.handler
        },
        {
          method: 'GET',
          path: '/models/{slug}',
          options: {
            ...publicRoute,
            validate: modelsController.detail.get.options.validate
          },
          handler: modelsController.detail.get.handler
        }
      ])
    }
  }
}

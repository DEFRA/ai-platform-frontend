import { connectModelController } from './controller.js'

/**
 * Sets up the routes used in the connect-to-model journey (J3: get research access).
 * Protected by the global sign-in gate (src/server/plugins/require-sign-in-globally.js).
 * These routes are registered in src/server/plugins/router.js.
 */
export const connectModel = {
  plugin: {
    name: 'connect-model',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/connect-model',
          handler: connectModelController.chooseProvider.get.handler
        },
        {
          method: 'POST',
          path: '/connect-model',
          options: {
            validate:
              connectModelController.chooseProvider.post.options.validate
          },
          handler: connectModelController.chooseProvider.post.handler
        },
        {
          method: 'GET',
          path: '/connect-model/select-model',
          handler: connectModelController.selectModel.get.handler
        },
        {
          method: 'POST',
          path: '/connect-model/select-model',
          options: {
            validate: connectModelController.selectModel.post.options.validate
          },
          handler: connectModelController.selectModel.post.handler
        },
        {
          method: 'GET',
          path: '/connect-model/confirm',
          handler: connectModelController.confirm.get.handler
        },
        {
          method: 'POST',
          path: '/connect-model/confirm',
          options: {
            validate: connectModelController.confirm.post.options.validate
          },
          handler: connectModelController.confirm.post.handler
        },
        {
          method: 'GET',
          path: '/connect-model/credential',
          handler: connectModelController.credential.get.handler
        }
      ])
    }
  }
}

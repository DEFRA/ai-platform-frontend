import { connectModelController } from './controller.js'
import { requireSignIn } from '#/server/common/helpers/require-sign-in.js'

const signedIn = { pre: [{ method: requireSignIn }] }

/**
 * Sets up the routes used in the connect-to-model journey (J3: get research access).
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
          options: signedIn,
          handler: connectModelController.chooseProvider.get.handler
        },
        {
          method: 'POST',
          path: '/connect-model',
          options: {
            ...signedIn,
            validate:
              connectModelController.chooseProvider.post.options.validate
          },
          handler: connectModelController.chooseProvider.post.handler
        },
        {
          method: 'GET',
          path: '/connect-model/select-model',
          options: signedIn,
          handler: connectModelController.selectModel.get.handler
        },
        {
          method: 'POST',
          path: '/connect-model/select-model',
          options: {
            ...signedIn,
            validate: connectModelController.selectModel.post.options.validate
          },
          handler: connectModelController.selectModel.post.handler
        },
        {
          method: 'GET',
          path: '/connect-model/confirm',
          options: signedIn,
          handler: connectModelController.confirm.get.handler
        },
        {
          method: 'POST',
          path: '/connect-model/confirm',
          options: {
            ...signedIn,
            validate: connectModelController.confirm.post.options.validate
          },
          handler: connectModelController.confirm.post.handler
        },
        {
          method: 'GET',
          path: '/connect-model/credential',
          options: signedIn,
          handler: connectModelController.credential.get.handler
        }
      ])
    }
  }
}

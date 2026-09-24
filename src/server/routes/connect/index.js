import { connectController } from './controller.js'
import { teamConnectController } from './team-controller.js'

const publicRoute = { app: { public: true } }

/**
 * Sets up the routes used in the connect-to-a-model journey: `/connect/shared/*`
 * for the research tier (B06), `/connect/team/*` for the team tier's
 * GitOps-shaped provisioning wait page (B09). `GET /connect` is public so
 * people can pick an access type before signing in; everything else
 * (including `POST /connect`) is protected by the global sign-in gate
 * (src/server/plugins/require-sign-in-globally.js).
 * These routes are registered in src/server/plugins/router.js.
 */
export const connect = {
  plugin: {
    // Named 'connect-routes' (not 'connect') to avoid colliding with the
    // @defra/hapi-connect plugin, which registers itself as 'connect'.
    name: 'connect-routes',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/connect',
          options: publicRoute,
          handler: connectController.accessType.get.handler
        },
        {
          method: 'POST',
          path: '/connect',
          options: {
            validate: connectController.accessType.post.options.validate
          },
          handler: connectController.accessType.post.handler
        },
        {
          method: 'GET',
          path: '/connect/shared/model',
          handler: connectController.selectModel.get.handler
        },
        {
          method: 'POST',
          path: '/connect/shared/model',
          options: {
            validate: connectController.selectModel.post.options.validate
          },
          handler: connectController.selectModel.post.handler
        },
        {
          method: 'GET',
          path: '/connect/shared/details',
          handler: connectController.details.get.handler
        },
        {
          method: 'POST',
          path: '/connect/shared/details',
          options: {
            validate: connectController.details.post.options.validate
          },
          handler: connectController.details.post.handler
        },
        {
          method: 'GET',
          path: '/connect/shared/check',
          handler: connectController.check.get.handler
        },
        {
          method: 'POST',
          path: '/connect/shared/check',
          handler: connectController.check.post.handler
        },
        {
          method: 'GET',
          path: '/connect/shared/credential',
          handler: connectController.credential.get.handler
        },
        {
          method: 'GET',
          path: '/connect/team/select',
          handler: teamConnectController.selectTeam.get.handler
        },
        {
          method: 'POST',
          path: '/connect/team/select',
          options: {
            validate: teamConnectController.selectTeam.post.options.validate
          },
          handler: teamConnectController.selectTeam.post.handler
        },
        {
          method: 'GET',
          path: '/connect/team/model',
          handler: teamConnectController.selectModel.get.handler
        },
        {
          method: 'POST',
          path: '/connect/team/model',
          options: {
            validate: teamConnectController.selectModel.post.options.validate
          },
          handler: teamConnectController.selectModel.post.handler
        },
        {
          method: 'GET',
          path: '/connect/team/details',
          handler: teamConnectController.details.get.handler
        },
        {
          method: 'POST',
          path: '/connect/team/details',
          options: {
            validate: teamConnectController.details.post.options.validate
          },
          handler: teamConnectController.details.post.handler
        },
        {
          method: 'GET',
          path: '/connect/team/check',
          handler: teamConnectController.check.get.handler
        },
        {
          method: 'POST',
          path: '/connect/team/check',
          handler: teamConnectController.check.post.handler
        },
        {
          method: 'GET',
          path: '/connect/team/request/{teamId}/{id}',
          handler: teamConnectController.request.get.handler
        },
        {
          method: 'GET',
          path: '/connect/team/credential',
          handler: teamConnectController.credential.get.handler
        }
      ])
    }
  }
}

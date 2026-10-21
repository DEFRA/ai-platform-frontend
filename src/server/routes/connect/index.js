import { connectController } from './controller.js'
import { startController } from './start-controller.js'
import { teamConnectController } from './team-controller.js'
import { teamRequestController } from './team-request-controller.js'

/**
 * Sets up the routes used in the connect-to-a-model journey: `/connect/shared/*`
 * for the research tier (B06), `/connect/team/*` for a team's request: choose
 * the team, models and what it is for, check, then the page that follows the
 * set-up to its end (B09). The two `start` routes are the
 * way in, from the Models page and a model's page. Every route here is
 * protected by the global sign-in gate
 * (src/server/plugins/require-sign-in-globally.js), which brings a signed-out
 * person back to the same address after they sign in.
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
          path: '/connect/shared/start',
          options: startController.shared.get.options,
          handler: startController.shared.get.handler
        },
        {
          method: 'GET',
          path: '/connect/team/start',
          options: startController.team.get.options,
          handler: startController.team.get.handler
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
          options: teamConnectController.selectTeam.get.options,
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
          options: teamConnectController.selectModels.get.options,
          handler: teamConnectController.selectModels.get.handler
        },
        {
          method: 'POST',
          path: '/connect/team/model',
          options: {
            validate: teamConnectController.selectModels.post.options.validate
          },
          handler: teamConnectController.selectModels.post.handler
        },
        {
          method: 'GET',
          path: '/connect/team/details',
          options: teamConnectController.details.get.options,
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
          path: '/connect/team/request/{team}/{id}',
          handler: teamRequestController.request.get.handler
        }
      ])
    }
  }
}

import { teamsController } from './controller.js'

/**
 * Sets up the routes for team select/create/manage (B08). Protected by the
 * global sign-in gate (src/server/plugins/require-sign-in-globally.js).
 * These routes are registered in src/server/plugins/router.js.
 */
export const teams = {
  plugin: {
    name: 'teams',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/teams',
          handler: teamsController.list.get.handler
        },
        {
          method: 'GET',
          path: '/teams/new',
          handler: teamsController.newTeam.get.handler
        },
        {
          method: 'POST',
          path: '/teams/new',
          options: {
            validate: teamsController.newTeam.post.options.validate
          },
          handler: teamsController.newTeam.post.handler
        },
        {
          method: 'GET',
          path: '/teams/new/check',
          handler: teamsController.check.get.handler
        },
        {
          method: 'POST',
          path: '/teams/new/check',
          handler: teamsController.check.post.handler
        },
        {
          method: 'GET',
          path: '/teams/{id}',
          handler: teamsController.team.get.handler
        },
        {
          method: 'POST',
          path: '/teams/{id}/members',
          options: {
            validate: teamsController.addMember.post.options.validate
          },
          handler: teamsController.addMember.post.handler
        }
      ])
    }
  }
}

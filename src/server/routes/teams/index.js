import { clientSecretsController } from './client-secrets-controller.js'
import { teamsController } from './controller.js'
import { detailsController } from './details-controller.js'
import { environmentSetUpController } from './environment-set-up-controller.js'
import {
  addMemberController,
  memberRoleController,
  membersController,
  removeMemberController
} from './members-controller.js'
import { removeModelController } from './models-controller.js'

const secrets = '/teams/{slug}/client-secrets/{credentialId}'

const routes = [
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
    path: '/teams/{slug}',
    handler: teamsController.team.get.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/details',
    handler: detailsController.show.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/details/service-code',
    handler: detailsController.serviceCode.get.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/details/service-code',
    options: detailsController.serviceCode.post.options,
    handler: detailsController.serviceCode.post.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/details/description',
    handler: detailsController.description.get.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/details/description',
    options: detailsController.description.post.options,
    handler: detailsController.description.post.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/members',
    handler: membersController.list.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/members/add',
    handler: addMemberController.get.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/members/add',
    options: addMemberController.post.options,
    handler: addMemberController.post.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/members/{memberId}/role',
    handler: memberRoleController.get.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/members/{memberId}/role',
    options: memberRoleController.post.options,
    handler: memberRoleController.post.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/members/{memberId}/remove',
    handler: removeMemberController.get.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/members/{memberId}/remove',
    handler: removeMemberController.post.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/models/{deploymentId}/remove',
    handler: removeModelController.get.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/models/{deploymentId}/remove',
    handler: removeModelController.post.handler
  },
  {
    method: 'GET',
    path: '/teams/{slug}/{environment}',
    handler: environmentSetUpController.get.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/{environment}',
    options: environmentSetUpController.post.options,
    handler: environmentSetUpController.post.handler
  },
  {
    method: 'GET',
    path: `${secrets}/view`,
    handler: clientSecretsController.reveal.get.handler
  },
  {
    method: 'POST',
    path: `${secrets}/view`,
    options: clientSecretsController.reveal.post.options,
    handler: clientSecretsController.reveal.post.handler
  },
  {
    method: 'GET',
    path: `${secrets}/revealed`,
    handler: clientSecretsController.revealed.get.handler
  },
  {
    method: 'GET',
    path: `${secrets}/rotate`,
    handler: clientSecretsController.rotate.get.handler
  },
  {
    method: 'POST',
    path: `${secrets}/rotate`,
    handler: clientSecretsController.rotate.post.handler
  },
  {
    method: 'GET',
    path: `${secrets}/rotated`,
    handler: clientSecretsController.rotated.get.handler
  },
  {
    method: 'GET',
    path: `${secrets}/revoke`,
    handler: clientSecretsController.revoke.get.handler
  },
  {
    method: 'POST',
    path: `${secrets}/revoke`,
    options: clientSecretsController.revoke.post.options,
    handler: clientSecretsController.revoke.post.handler
  }
]

/**
 * Sets up the routes for a person's teams (B08): the list, creating a team,
 * a team's Models, Members and Details tabs, adding, changing and removing its members, changing its service code and description, removing one of its models, setting up another environment from its models in the first (`/teams/{slug}/{environment}`), and its client secrets.
 * Protected by the global sign-in gate (src/server/plugins/require-sign-in-globally.js).
 * These routes are registered in src/server/plugins/router.js.
 */
export const teams = {
  plugin: {
    name: 'teams',
    register(server) {
      server.route(routes)
    }
  }
}

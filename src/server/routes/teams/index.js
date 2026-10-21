import { clientSecretsController } from './client-secrets-controller.js'
import { teamsController } from './controller.js'
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
    method: 'POST',
    path: '/teams/{slug}/service-code',
    options: {
      validate: teamsController.setServiceCode.post.options.validate
    },
    handler: teamsController.setServiceCode.post.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/members',
    options: {
      validate: teamsController.addMember.post.options.validate
    },
    handler: teamsController.addMember.post.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/members/{memberId}/role',
    options: {
      validate: teamsController.setMemberRole.post.options.validate
    },
    handler: teamsController.setMemberRole.post.handler
  },
  {
    method: 'POST',
    path: '/teams/{slug}/members/{memberId}/remove',
    handler: teamsController.removeMember.post.handler
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
 * a team's Models tab, removing one of its models, and its client secrets.
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

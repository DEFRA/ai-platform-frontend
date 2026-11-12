import { environmentsController } from './controller.js'
import { limitsController } from './limits-controller.js'
import { environmentSetUpController } from './set-up-controller.js'

const limits = '/environments/{slug}/{environment}/limits'

const routes = [
  {
    method: 'GET',
    path: '/environments',
    handler: environmentsController.list.handler
  },
  {
    method: 'GET',
    path: '/environments/{slug}',
    handler: environmentsController.overview.handler
  },
  {
    method: 'GET',
    path: '/environments/{slug}/{environment}',
    handler: environmentsController.environment.handler
  },
  {
    method: 'GET',
    path: limits,
    handler: limitsController.question.get.handler
  },
  {
    method: 'POST',
    path: limits,
    options: limitsController.question.post.options,
    handler: limitsController.question.post.handler
  },
  {
    method: 'GET',
    path: `${limits}/check`,
    handler: limitsController.check.get.handler
  },
  {
    method: 'POST',
    path: `${limits}/check`,
    options: limitsController.check.post.options,
    handler: limitsController.check.post.handler
  },
  {
    method: 'GET',
    path: '/environments/{slug}/{environment}/set-up',
    handler: environmentSetUpController.get.handler
  },
  {
    method: 'POST',
    path: '/environments/{slug}/{environment}/set-up',
    options: environmentSetUpController.post.options,
    handler: environmentSetUpController.post.handler
  }
]

/**
 * Sets up the routes of the Environments and deployments section (B30): the
 * person's teams, one team's overview, one of its environments, and setting up
 * another environment from its models in the first. One team at a time: each
 * address carries its team. Protected by the global sign-in gate
 * (src/server/plugins/require-sign-in-globally.js). Registered in
 * src/server/plugins/router.js.
 */
export const environments = {
  plugin: {
    name: 'environments',
    register(server) {
      server.route(routes)
    }
  }
}

import { environmentsController } from './controller.js'
import { limitsController } from './limits-controller.js'
import { environmentSetUpController } from './set-up-controller.js'
import { setUpApplicationsController } from './set-up-applications.js'
import { federateQuestions } from './federate-questions.js'
import { federateEnvironments } from './federate-environments.js'
import { federateCheck } from './federate-check.js'
import { federateProgress } from './federate-progress.js'
import { applicationController } from './application-controller.js'

const limits = '/environments/{slug}/{environment}/limits'
const federate = '/environments/{slug}/federate'
const application = '/environments/{slug}/{environment}/applications/{id}'

// A step of the Federate journey: the page, and the form it posts.
function stepRoutes(path, step) {
  return [
    {
      method: 'GET',
      path,
      options: step.get.options,
      handler: step.get.handler
    },
    {
      method: 'POST',
      path,
      options: step.post.options,
      handler: step.post.handler
    }
  ]
}

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
  },
  {
    method: 'GET',
    path: '/environments/{slug}/{environment}/set-up/applications',
    handler: setUpApplicationsController.get.handler
  },
  {
    method: 'POST',
    path: '/environments/{slug}/{environment}/set-up/applications',
    options: setUpApplicationsController.post.options,
    handler: setUpApplicationsController.post.handler
  },
  ...stepRoutes(federate, federateQuestions.where),
  ...stepRoutes(`${federate}/service`, federateQuestions.service),
  ...stepRoutes(`${federate}/principal-id`, federateQuestions.principalId),
  ...stepRoutes(`${federate}/name`, federateQuestions.name),
  ...stepRoutes(`${federate}/environments`, federateEnvironments),
  {
    method: 'GET',
    path: `${federate}/check`,
    handler: federateCheck.get.handler
  },
  {
    method: 'POST',
    path: `${federate}/check`,
    options: federateCheck.post.options,
    handler: federateCheck.post.handler
  },
  {
    method: 'GET',
    path: `${federate}/progress/{id}`,
    handler: federateProgress.get.handler
  },
  {
    method: 'GET',
    path: `${application}/change`,
    handler: applicationController.change.handler
  },
  {
    method: 'GET',
    path: `${application}/remove`,
    handler: applicationController.remove.get.handler
  },
  {
    method: 'POST',
    path: `${application}/remove`,
    handler: applicationController.remove.post.handler
  }
]

/**
 * Sets up the routes of the Environments and deployments section (B30): the
 * person's teams, one team's overview, one of its environments, setting up
 * another environment from its models in the first, and its applications
 * (B18): federating one, changing or removing it. One team at a time: each
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

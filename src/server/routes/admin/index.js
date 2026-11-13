import { adminAuditController } from './audit.js'
import { adminController } from './controller.js'
import { adminDeploymentController } from './deployment.js'
import { adminCredentialsController } from './deployment-credentials.js'
import { adminDeploymentsController } from './deployments.js'
import {
  adminAddMemberController,
  adminPeopleSearchController,
  adminRemoveMemberController
} from './members.js'

const team = '/admin/teams/{id}'
const deployment = '/admin/deployments/{teamId}/{environment}'

// The pages of the credential actions: which environments, a reason (Disable
// and Revoke) and the confirmation after.
function credentialRoutes() {
  const { disable, disableReason, disabled, revoke, revokeReason, revoked } =
    adminCredentialsController
  const { enable } = adminCredentialsController
  const pages = [
    ['disable', disable],
    ['disable/reason', disableReason],
    ['revoke', revoke],
    ['revoke/reason', revokeReason],
    ['enable', enable]
  ]

  return [
    ...pages.flatMap(([path, { get, post }]) => [
      {
        method: 'GET',
        path: `${deployment}/credentials/${path}`,
        handler: get.handler
      },
      {
        method: 'POST',
        path: `${deployment}/credentials/${path}`,
        handler: post.handler
      }
    ]),
    {
      method: 'GET',
      path: `${deployment}/credentials/disabled`,
      handler: disabled.handler
    },
    {
      method: 'GET',
      path: `${deployment}/credentials/revoked`,
      handler: revoked.handler
    }
  ]
}

const routes = [
  ...credentialRoutes(),
  { method: 'GET', path: '/admin', handler: adminController.index.handler },
  {
    method: 'GET',
    path: '/admin/teams',
    handler: adminController.teams.handler
  },
  { method: 'GET', path: team, handler: adminController.team.handler },
  {
    method: 'GET',
    path: '/admin/deployments',
    handler: adminDeploymentsController.handler
  },
  {
    method: 'GET',
    path: deployment,
    handler: adminDeploymentController.get.handler
  },
  {
    method: 'POST',
    path: `${deployment}/models/{entryId}/reconcile`,
    handler: adminDeploymentController.reconcile.handler
  },
  {
    method: 'POST',
    path: `${deployment}/models/{entryId}/retry`,
    handler: adminDeploymentController.retry.handler
  },
  {
    method: 'GET',
    path: '/admin/audit',
    handler: adminAuditController.handler
  },
  {
    method: 'GET',
    path: `${team}/members/add`,
    handler: adminAddMemberController.get.handler
  },
  {
    method: 'POST',
    path: `${team}/members/add`,
    options: adminAddMemberController.post.options,
    handler: adminAddMemberController.post.handler
  },
  {
    method: 'POST',
    path: `${team}/members/add/people`,
    options: adminPeopleSearchController.options,
    handler: adminPeopleSearchController.handler
  },
  {
    method: 'GET',
    path: `${team}/members/{memberId}/remove`,
    handler: adminRemoveMemberController.get.handler
  },
  {
    method: 'POST',
    path: `${team}/members/{memberId}/remove`,
    handler: adminRemoveMemberController.post.handler
  }
]

/**
 * Sets up the Platform Admin area (B31): the Teams tab (every team, a team's
 * page, adding and removing its members), the Deployments tab (each team's
 * deployment in an environment, its health and its credentials) and the Audit
 * log tab. Protected by the global
 * sign-in gate (src/server/plugins/require-sign-in-globally.js); who may use
 * a page is the backend's decision, asked on every request.
 * These routes are registered in src/server/plugins/router.js.
 */
export const admin = {
  plugin: {
    name: 'admin',
    register(server) {
      server.route(routes)
    }
  }
}

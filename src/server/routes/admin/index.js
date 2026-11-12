import { adminController } from './controller.js'
import {
  adminAddMemberController,
  adminPeopleSearchController,
  adminRemoveMemberController
} from './members.js'

const team = '/admin/teams/{id}'

const routes = [
  { method: 'GET', path: '/admin', handler: adminController.index.handler },
  {
    method: 'GET',
    path: '/admin/teams',
    handler: adminController.teams.handler
  },
  { method: 'GET', path: team, handler: adminController.team.handler },
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
 * Sets up the Platform Admin area (B31, Teams tab): the list of every team,
 * a team's page, and adding and removing its members. Protected by the global
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

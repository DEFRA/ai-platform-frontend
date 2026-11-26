import { usageController } from './controller.js'

const routes = [
  { method: 'GET', path: '/usage', handler: usageController.chooser },
  { method: 'GET', path: '/usage/{slug}', handler: usageController.overview },
  {
    method: 'GET',
    path: '/usage/{slug}/costs',
    handler: usageController.costs
  },
  {
    method: 'GET',
    path: '/usage/{slug}/costs.csv',
    handler: usageController.costsCsv
  },
  {
    method: 'GET',
    path: '/usage/{slug}/carbon',
    handler: usageController.carbon
  }
]

/**
 * The Usage section: a team's usage, what it costs and, once agreed, its
 * carbon. Protected by the global sign-in gate
 * (src/server/plugins/require-sign-in-globally.js). Registered in
 * src/server/plugins/router.js.
 */
export const usage = {
  plugin: {
    name: 'usage',
    register(server) {
      server.route(routes)
    }
  }
}

import { sessionController } from './controller.js'

/**
 * Sets up the routes the timeout warning uses. Registered in
 * src/server/plugins/router.js. Both need a signed-in session.
 */
export const session = {
  plugin: {
    name: 'session',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/session/status',
          options: { app: { keepsIdleTime: true } },
          ...sessionController.status
        },
        {
          method: 'POST',
          path: '/session/extend',
          ...sessionController.extend
        }
      ])
    }
  }
}

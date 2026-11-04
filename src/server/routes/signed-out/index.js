import { signedOutController } from './controller.js'

/**
 * Sets up the /signed-out page: where a session that ended on its own sends
 * the person, with no script needed. Registered in src/server/plugins/router.js.
 */
export const signedOut = {
  plugin: {
    name: 'signed-out',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/signed-out',
          ...signedOutController,
          // keepsIdleTime: landing here must not restart the idle time of a
          // session that is still live (the person did not ask to be here).
          options: {
            ...signedOutController.options,
            app: { public: true, keepsIdleTime: true }
          }
        }
      ])
    }
  }
}

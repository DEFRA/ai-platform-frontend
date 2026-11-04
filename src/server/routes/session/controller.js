import { sessionTimes } from '#/server/common/helpers/session-lifetime.js'

export const sessionController = {
  // Read only: the route opts out of restarting the idle time (see
  // require-sign-in-globally.js), so asking how long is left never adds to it.
  status: {
    handler(request) {
      return sessionTimes(request)
    }
  },
  // "Stay signed in": any request restarts the idle time, so the plugin has
  // already done it; this only answers with the new times. The overall limit
  // cannot be moved.
  extend: {
    handler(request) {
      return sessionTimes(request)
    }
  }
}

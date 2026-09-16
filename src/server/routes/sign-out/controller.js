import { statusCodes } from '#/server/common/constants/status-codes.js'
import { clearSessionUser } from '#/server/common/helpers/session.js'

export const signOutController = {
  handler(request, h) {
    clearSessionUser(request)

    return h.redirect('/').code(statusCodes.seeOther)
  }
}

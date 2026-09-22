import { statusCodes } from '#/server/common/constants/status-codes.js'

export const signInController = {
  // The only sign-in entry point: bounces straight to the Entra ID OIDC login.
  get: {
    handler(request, h) {
      const returnTo = request.query.returnTo
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''

      return h.redirect(`/auth/login${query}`).code(statusCodes.seeOther)
    }
  }
}

import * as client from 'openid-client'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { config } from '#/config/config.js'
import { resetSession } from '#/server/common/helpers/session.js'
import { getOidcConfig } from '#/server/common/helpers/oidc-client.js'

export const signOutController = {
  async handler(request, h) {
    // Everything the person left in the session goes with them: the next
    // person on this browser must not inherit a half-made request, a team,
    // or a credential not yet shown.
    resetSession(request)

    // Entra ID is the only sign-in mechanism, so sign-out always ends the Entra
    // session too; falling back to '/' only if the end-session URL can't be built.
    try {
      const oidcConfig = await getOidcConfig()
      const endSessionUrl = client.buildEndSessionUrl(oidcConfig, {
        post_logout_redirect_uri: `${config.get('appBaseUrl')}/`
      })

      return h.redirect(endSessionUrl.href).code(statusCodes.seeOther)
    } catch (error) {
      request.logger.warn(
        { err: error },
        'Failed to build Entra ID end-session URL'
      )
      return h.redirect('/').code(statusCodes.seeOther)
    }
  }
}

import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'

export const signInQuerySchema = Joi.object({
  returnTo: Joi.string().optional(),
  // Forwarded to Entra ID so "try a different account" actually prompts,
  // instead of silently reusing Entra ID's existing SSO session.
  prompt: Joi.string().valid('select_account').optional()
}).unknown(false)

export const signInController = {
  // The only sign-in entry point: bounces straight to the Entra ID OIDC login.
  get: {
    options: {
      validate: { query: signInQuerySchema }
    },
    handler(request, h) {
      const { returnTo, prompt } = request.query

      const params = new URLSearchParams()
      if (returnTo) {
        params.set('returnTo', returnTo)
      }
      if (prompt) {
        params.set('prompt', prompt)
      }
      const query = params.toString() ? `?${params.toString()}` : ''

      return h.redirect(`/auth/login${query}`).code(statusCodes.seeOther)
    }
  }
}

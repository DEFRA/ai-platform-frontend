import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  setSessionUser,
  getPendingOidcIdentity,
  clearPendingOidcIdentity
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'

const teamPayloadSchema = Joi.object({
  teamName: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'Enter your team name',
    'any.required': 'Enter your team name'
  }),
  returnTo: Joi.string().allow('').optional()
})

function teamViewModel(request, identity, { errors, values } = {}) {
  return {
    pageTitle: errors ? 'Error: Confirm your team' : 'Confirm your team',
    heading: 'Confirm your team',
    email: identity?.email,
    displayName: identity?.displayName,
    returnTo: request.query.returnTo ?? request.payload?.returnTo ?? '',
    errorSummary: errors ? buildErrorSummary(errors) : null,
    fieldErrors: errors ? buildFieldErrors(errors) : {},
    values: values ?? {}
  }
}

export const signInController = {
  // The only sign-in entry point: bounces straight to the Entra ID OIDC login.
  get: {
    handler(request, h) {
      const returnTo = request.query.returnTo
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''

      return h.redirect(`/auth/login${query}`).code(statusCodes.seeOther)
    }
  },
  team: {
    get: {
      handler(request, h) {
        const identity = getPendingOidcIdentity(request)

        if (!identity) {
          return h.redirect('/sign-in').code(statusCodes.seeOther)
        }

        return h.view('sign-in/team', teamViewModel(request, identity))
      }
    },
    post: {
      options: {
        validate: {
          payload: teamPayloadSchema,
          failAction: (request, h, error) =>
            h
              .view(
                'sign-in/team',
                teamViewModel(request, getPendingOidcIdentity(request), {
                  errors: error,
                  values: request.payload
                })
              )
              .code(statusCodes.badRequest)
              .takeover()
        }
      },
      async handler(request, h) {
        const identity = getPendingOidcIdentity(request)

        if (!identity) {
          return h.redirect('/sign-in').code(statusCodes.seeOther)
        }

        const { teamName, returnTo } = request.payload

        try {
          const { user, team } = await apiClient(request).post('/v1/users', {
            email: identity.email,
            displayName: identity.displayName,
            teamName
          })

          setSessionUser(request, {
            id: user._id,
            email: user.email,
            displayName: user.displayName,
            teamId: team._id,
            teamName: team.name
          })
          clearPendingOidcIdentity(request)

          return h
            .redirect(returnTo || '/connect-model')
            .code(statusCodes.seeOther)
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.code === 'domain-not-allowed'
          ) {
            return h
              .view(
                'sign-in/team',
                teamViewModel(request, identity, {
                  errors: {
                    details: [{ message: error.message, path: ['teamName'] }]
                  },
                  values: request.payload
                })
              )
              .code(statusCodes.badRequest)
          }

          throw error
        }
      }
    }
  }
}

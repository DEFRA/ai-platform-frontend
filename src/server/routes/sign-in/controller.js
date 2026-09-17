import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { setSessionUser } from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'

const payloadSchema = Joi.object({
  email: Joi.string().email().max(254).required().messages({
    'string.empty': 'Enter your email address',
    'string.email': 'Enter an email address in the correct format',
    'any.required': 'Enter your email address'
  }),
  displayName: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'Enter your name',
    'any.required': 'Enter your name'
  }),
  teamName: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'Enter your team name',
    'any.required': 'Enter your team name'
  }),
  returnTo: Joi.string().allow('').optional()
})

function viewModel(request, { errors, values } = {}) {
  return {
    pageTitle: errors ? 'Error: Sign in' : 'Sign in',
    heading: 'Sign in',
    returnTo: request.query.returnTo ?? request.payload?.returnTo ?? '',
    errorSummary: errors ? buildErrorSummary(errors) : null,
    fieldErrors: errors ? buildFieldErrors(errors) : {},
    values: values ?? {}
  }
}

export const signInController = {
  get: {
    handler(request, h) {
      return h.view('sign-in/index', viewModel(request))
    }
  },
  post: {
    options: {
      validate: {
        payload: payloadSchema,
        failAction: (request, h, error) =>
          h
            .view(
              'sign-in/index',
              viewModel(request, { errors: error, values: request.payload })
            )
            .code(statusCodes.badRequest)
            .takeover()
      }
    },
    async handler(request, h) {
      const { email, displayName, teamName, returnTo } = request.payload

      try {
        const { user, team } = await apiClient(request).post('/v1/users', {
          email,
          displayName,
          teamName
        })

        setSessionUser(request, {
          id: user._id,
          email: user.email,
          displayName: user.displayName,
          teamId: team._id,
          teamName: team.name
        })

        return h
          .redirect(returnTo || '/connect-model')
          .code(statusCodes.seeOther)
      } catch (error) {
        if (error instanceof ApiError && error.code === 'domain-not-allowed') {
          return h
            .view(
              'sign-in/index',
              viewModel(request, {
                errors: {
                  details: [{ message: error.message, path: ['email'] }]
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

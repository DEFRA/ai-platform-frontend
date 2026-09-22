import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getSessionUser,
  getPendingAccess,
  setPendingAccess,
  setIssuedCredential,
  takeIssuedCredential
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'

const accessTypeSchema = Joi.object({
  accessType: Joi.string().valid('shared').required().messages({
    'any.only': 'Select an access type',
    'any.required': 'Select an access type'
  }),
  modelSlug: Joi.string().allow('').optional()
})

const selectModelSchema = Joi.object({
  modelSlug: Joi.string()
    .required()
    .messages({ 'any.required': 'Select a model' })
})

const detailsSchema = Joi.object({
  purpose: Joi.string().trim().max(500).allow('').optional().messages({
    'string.max': 'Purpose must be 500 characters or fewer'
  }),
  agreeToTerms: Joi.string().valid('true').required().messages({
    'any.required': 'You must accept the terms to continue',
    'any.only': 'You must accept the terms to continue'
  })
})

function redirectToStart(h) {
  return h.redirect('/connect').takeover()
}

function buildAccessTypeItems(selectedAccessType) {
  return [
    {
      value: 'shared',
      text: 'Shared model for research',
      hint: { text: 'A rate-limited credential for a shared model.' },
      checked: selectedAccessType === 'shared' || !selectedAccessType
    },
    {
      value: 'team',
      text: 'Dedicated model for your team',
      hint: { text: 'Not available yet.' },
      disabled: true
    }
  ]
}

function buildModelItems(models, selectedModelSlug) {
  return models.map((model) => ({
    value: model.slug,
    text: model.displayName,
    hint: { text: model.description },
    checked: model.slug === selectedModelSlug
  }))
}

export const connectController = {
  accessType: {
    get: {
      handler(request, h) {
        const pendingAccess = getPendingAccess(request) ?? {}
        const modelSlug = request.query.modelSlug ?? pendingAccess.modelSlug

        return h.view('connect/index', {
          pageTitle: 'Connect to a model',
          heading: 'Connect to a model',
          accessTypeItems: buildAccessTypeItems(pendingAccess.accessType),
          modelSlug: modelSlug ?? '',
          signedIn: Boolean(getSessionUser(request)),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: accessTypeSchema,
          failAction: (request, h, error) =>
            h
              .view('connect/index', {
                pageTitle: 'Error: Connect to a model',
                heading: 'Connect to a model',
                accessTypeItems: buildAccessTypeItems(
                  request.payload.accessType
                ),
                modelSlug: request.payload.modelSlug ?? '',
                signedIn: Boolean(getSessionUser(request)),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
        }
      },
      handler(request, h) {
        setPendingAccess(request, {
          accessType: request.payload.accessType,
          modelSlug: request.payload.modelSlug || undefined
        })

        return h.redirect('/connect/shared/model').code(statusCodes.seeOther)
      }
    }
  },

  selectModel: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.accessType) {
          return redirectToStart(h)
        }

        const { items } = await apiClient(request).get(
          '/v1/models?tier=research'
        )

        return h.view('connect/shared/model', {
          pageTitle: 'Choose a model',
          heading: 'Choose a model',
          modelItems: buildModelItems(items, pendingAccess.modelSlug),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: selectModelSchema,
          failAction: async (request, h, error) => {
            const { items } = await apiClient(request).get(
              '/v1/models?tier=research'
            )

            return h
              .view('connect/shared/model', {
                pageTitle: 'Error: Choose a model',
                heading: 'Choose a model',
                modelItems: buildModelItems(items, request.payload.modelSlug),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.accessType) {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          modelSlug: request.payload.modelSlug
        })

        return h.redirect('/connect/shared/details').code(statusCodes.seeOther)
      }
    }
  },

  details: {
    get: {
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.modelSlug) {
          return redirectToStart(h)
        }

        return h.view('connect/shared/details', {
          pageTitle: 'Say what it is for',
          heading: 'Say what it is for',
          values: { purpose: pendingAccess.purpose ?? '' },
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: detailsSchema,
          failAction: (request, h, error) =>
            h
              .view('connect/shared/details', {
                pageTitle: 'Error: Say what it is for',
                heading: 'Say what it is for',
                values: request.payload,
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
        }
      },
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.modelSlug) {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          purpose: request.payload.purpose ?? ''
        })

        return h.redirect('/connect/shared/check').code(statusCodes.seeOther)
      }
    }
  },

  check: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.modelSlug) {
          return redirectToStart(h)
        }

        const model = await apiClient(request).get(
          `/v1/models/${pendingAccess.modelSlug}`
        )

        return h.view('connect/shared/check', {
          pageTitle: 'Check your answers',
          heading: 'Check your answers',
          model,
          purpose: pendingAccess.purpose,
          errorMessage: null,
          errorAction: null
        })
      }
    },
    post: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)
        const sessionUser = getSessionUser(request)

        if (!pendingAccess?.modelSlug) {
          return redirectToStart(h)
        }

        // Session can legitimately expire mid-journey (B06 acceptance
        // criteria): send the person back to the start of the flow.
        if (!sessionUser) {
          return redirectToStart(h)
        }

        try {
          const { credential, secret } = await apiClient(request).post(
            '/v1/credentials',
            {
              modelSlug: pendingAccess.modelSlug,
              tier: 'research',
              purpose: pendingAccess.purpose || undefined
            },
            { userId: sessionUser.id, idempotencyKey: randomUUID() }
          )

          const model = await apiClient(request).get(
            `/v1/models/${pendingAccess.modelSlug}`
          )

          setIssuedCredential(request, { credential, secret, model })

          return h
            .redirect('/connect/shared/credential')
            .code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError) {
            const model = await apiClient(request).get(
              `/v1/models/${pendingAccess.modelSlug}`
            )

            return h
              .view('connect/shared/check', {
                pageTitle: 'Check your answers',
                heading: 'Check your answers',
                model,
                purpose: pendingAccess.purpose,
                errorMessage: errorMessageForCode(error),
                errorAction: error.code === 'active-credential-exists'
              })
              .code(error.statusCode)
          }

          throw error
        }
      }
    }
  },

  credential: {
    get: {
      handler(request, h) {
        const issued = takeIssuedCredential(request)

        if (!issued) {
          return h.redirect('/connect')
        }

        return h
          .view('connect/shared/credential', {
            pageTitle: 'Your connection details',
            heading: 'Your connection details',
            ...issued
          })
          .header('cache-control', 'no-store')
      }
    }
  }
}

function errorMessageForCode(error) {
  if (error.code === 'active-credential-exists') {
    return 'You already have an active credential for this model.'
  }

  if (error.code === 'model-not-eligible') {
    return 'This model is not available for the research tier.'
  }

  if (error.code === 'upstream-unavailable') {
    return 'We could not issue a credential right now. Please try again.'
  }

  return error.message
}

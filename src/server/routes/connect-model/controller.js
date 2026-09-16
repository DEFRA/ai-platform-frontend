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

// Only OpenAI is offered for this initial slice; more providers can be added
// once the backend catalogue seed grows.
const PROVIDERS = [{ value: 'openai', text: 'OpenAI' }]

const providerSchema = Joi.object({
  provider: Joi.string()
    .valid(...PROVIDERS.map((p) => p.value))
    .required()
    .messages({ 'any.only': 'Select a provider', 'any.required': 'Select a provider' })
})

const selectModelSchema = Joi.object({
  modelSlug: Joi.string()
    .required()
    .messages({ 'any.required': 'Select a model' })
})

const confirmSchema = Joi.object({
  agreeToTerms: Joi.string().valid('true').required().messages({
    'any.required': 'You must accept the terms to continue',
    'any.only': 'You must accept the terms to continue'
  })
})

function redirectToStart(h) {
  return h.redirect('/connect-model').takeover()
}

function buildProviderItems(selectedProvider) {
  return PROVIDERS.map((provider) => ({
    value: provider.value,
    text: provider.text,
    checked: provider.value === selectedProvider
  }))
}

function buildModelItems(models, selectedModelSlug) {
  return models.map((model) => ({
    value: model.slug,
    text: model.displayName,
    hint: { text: model.description },
    checked: model.slug === selectedModelSlug
  }))
}

export const connectModelController = {
  chooseProvider: {
    get: {
      handler(request, h) {
        const pendingAccess = getPendingAccess(request) ?? {}

        return h.view('connect-model/choose-provider', {
          pageTitle: 'Connect to a model',
          heading: 'Connect to a model',
          providerItems: buildProviderItems(pendingAccess.provider),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: providerSchema,
          failAction: (request, h, error) =>
            h
              .view('connect-model/choose-provider', {
                pageTitle: 'Error: Connect to a model',
                heading: 'Connect to a model',
                providerItems: buildProviderItems(request.payload.provider),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
        }
      },
      handler(request, h) {
        setPendingAccess(request, { provider: request.payload.provider })

        return h.redirect('/connect-model/select-model').code(statusCodes.seeOther)
      }
    }
  },

  selectModel: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.provider) {
          return redirectToStart(h)
        }

        const { items } = await apiClient(request).get(
          `/v1/models?provider=${pendingAccess.provider}`
        )

        return h.view('connect-model/select-model', {
          pageTitle: 'Select a model',
          heading: 'Select a model',
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
            const pendingAccess = getPendingAccess(request)
            const { items } = await apiClient(request).get(
              `/v1/models?provider=${pendingAccess?.provider}`
            )

            return h
              .view('connect-model/select-model', {
                pageTitle: 'Error: Select a model',
                heading: 'Select a model',
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

        if (!pendingAccess?.provider) {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          modelSlug: request.payload.modelSlug
        })

        return h.redirect('/connect-model/confirm').code(statusCodes.seeOther)
      }
    }
  },

  confirm: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.modelSlug) {
          return redirectToStart(h)
        }

        const model = await apiClient(request).get(
          `/v1/models/${pendingAccess.modelSlug}`
        )

        return h.view('connect-model/confirm', {
          pageTitle: 'Check your answers',
          heading: 'Check your answers',
          model,
          errorSummary: null,
          fieldErrors: {},
          errorMessage: null
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: confirmSchema,
          failAction: async (request, h, error) => {
            const pendingAccess = getPendingAccess(request)
            const model = await apiClient(request).get(
              `/v1/models/${pendingAccess.modelSlug}`
            )

            return h
              .view('connect-model/confirm', {
                pageTitle: 'Error: Check your answers',
                heading: 'Check your answers',
                model,
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error),
                errorMessage: null
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)
        const sessionUser = getSessionUser(request)

        if (!pendingAccess?.modelSlug) {
          return redirectToStart(h)
        }

        try {
          const { credential, secret } = await apiClient(request).post(
            '/v1/credentials',
            { modelSlug: pendingAccess.modelSlug },
            { userId: sessionUser.id, idempotencyKey: randomUUID() }
          )

          const model = await apiClient(request).get(
            `/v1/models/${pendingAccess.modelSlug}`
          )

          setIssuedCredential(request, { credential, secret, model })

          return h.redirect('/connect-model/credential').code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError) {
            const model = await apiClient(request).get(
              `/v1/models/${pendingAccess.modelSlug}`
            )

            return h
              .view('connect-model/confirm', {
                pageTitle: 'Check your answers',
                heading: 'Check your answers',
                model,
                errorSummary: null,
                fieldErrors: {},
                errorMessage: error.message
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
          return h.redirect('/connect-model')
        }

        return h.view('connect-model/credential', {
          pageTitle: 'Your connection details',
          heading: 'Your connection details',
          ...issued
        })
      }
    }
  }
}

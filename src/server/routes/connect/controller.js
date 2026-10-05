import { randomUUID } from 'node:crypto'
import Joi from 'joi'
import { addDays } from 'date-fns'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { buildGatewayRequest } from '#/server/common/helpers/gateway-request.js'
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
import { formatDate } from '#/config/nunjucks/filters/format-date.js'

const RESEARCH_CREDENTIAL_DAYS = 7

const accessTypeSchema = Joi.object({
  accessType: Joi.string().valid('shared', 'team').required().messages({
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

const MODEL_PLACEHOLDER = '{model}'

const detailsSchema = Joi.object({
  purpose: Joi.string()
    .trim()
    .max(500)
    .required()
    .messages({
      'string.empty': `Enter what you will use ${MODEL_PLACEHOLDER} for`,
      'any.required': `Enter what you will use ${MODEL_PLACEHOLDER} for`,
      'string.max': 'Purpose must be 500 characters or fewer'
    }),
  agreeToTerms: Joi.string().valid('true').required().messages({
    'any.required': 'Confirm that you understand the limits',
    'any.only': 'Confirm that you understand the limits'
  })
})

function redirectToStart(h) {
  return h.redirect('/connect').takeover()
}

function substituteModelPlaceholder(text, modelDisplayName) {
  return text.replaceAll(MODEL_PLACEHOLDER, modelDisplayName ?? 'this model')
}

function buildDetailsErrorSummary(error, modelDisplayName) {
  return buildErrorSummary(error).map((item) => ({
    ...item,
    text: substituteModelPlaceholder(item.text, modelDisplayName)
  }))
}

function buildDetailsFieldErrors(error, modelDisplayName) {
  const fieldErrors = buildFieldErrors(error)

  return Object.fromEntries(
    Object.entries(fieldErrors).map(([key, fieldError]) => [
      key,
      { text: substituteModelPlaceholder(fieldError.text, modelDisplayName) }
    ])
  )
}

function buildAccessTypeItems(selectedAccessType) {
  return [
    {
      value: 'shared',
      text: 'Just for me, to research or try something out',
      hint: {
        text: 'A key that lasts 7 days in Sandbox. No team needed. Ready in about a minute.'
      },
      checked: selectedAccessType === 'shared' || !selectedAccessType
    },
    {
      value: 'team',
      text: 'For my team',
      hint: {
        text: 'A key the whole team shares. Admins can rotate or revoke it. Takes a few minutes to set up.'
      },
      checked: selectedAccessType === 'team'
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

// Best-effort lookup for the "You are connecting to {model}" hint - the
// access-type page must still render if the model can't be looked up.
async function getModelDisplayName(request, modelSlug) {
  if (!modelSlug) {
    return undefined
  }

  try {
    const model = await apiClient(request).get(`/v1/models/${modelSlug}`)
    return model.displayName
  } catch {
    return undefined
  }
}

function buildCheckAnswersRows(model, purpose) {
  const rows = [
    {
      key: { text: 'Model' },
      value: { text: model.displayName },
      actions: {
        items: [
          {
            href: '/connect/shared/model',
            text: 'Change',
            visuallyHiddenText: 'model'
          }
        ]
      }
    },
    {
      key: { text: 'Access for' },
      value: { text: 'Just me, research' },
      actions: {
        items: [
          { href: '/connect', text: 'Change', visuallyHiddenText: 'access for' }
        ]
      }
    },
    {
      key: { text: 'What you will use it for' },
      value: { text: purpose },
      actions: {
        items: [
          {
            href: '/connect/shared/details',
            text: 'Change',
            visuallyHiddenText: 'what you will use it for'
          }
        ]
      }
    },
    { key: { text: 'Environment' }, value: { text: 'Sandbox' } }
  ]

  if (model.limitsDefault?.requestsPerMinute) {
    rows.push({
      key: { text: 'Rate limit' },
      value: {
        text: `${model.limitsDefault.requestsPerMinute} requests a minute`
      }
    })
  }

  if (model.limitsDefault?.tokensPerDay) {
    rows.push({
      key: { text: 'Daily allowance' },
      value: { text: `${model.limitsDefault.tokensPerDay} tokens` }
    })
  }

  rows.push({
    key: { text: 'Runs out' },
    value: { text: formatDate(addDays(new Date(), RESEARCH_CREDENTIAL_DAYS)) }
  })

  return rows
}

export const connectController = {
  accessType: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request) ?? {}
        const modelSlug = request.query.modelSlug ?? pendingAccess.modelSlug

        return h.view('connect/index', {
          pageTitle: 'What access do you need?',
          heading: 'What access do you need?',
          accessTypeItems: buildAccessTypeItems(pendingAccess.accessType),
          modelSlug: modelSlug ?? '',
          modelDisplayName: await getModelDisplayName(request, modelSlug),
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
          failAction: async (request, h, error) =>
            h
              .view('connect/index', {
                pageTitle: 'Error: What access do you need?',
                heading: 'What access do you need?',
                accessTypeItems: buildAccessTypeItems(
                  request.payload.accessType
                ),
                modelSlug: request.payload.modelSlug ?? '',
                modelDisplayName: await getModelDisplayName(
                  request,
                  request.payload.modelSlug
                ),
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

        const nextStep =
          request.payload.accessType === 'team'
            ? '/connect/team/select'
            : '/connect/shared/model'

        return h.redirect(nextStep).code(statusCodes.seeOther)
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
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.modelSlug) {
          return redirectToStart(h)
        }

        const modelDisplayName = await getModelDisplayName(
          request,
          pendingAccess.modelSlug
        )
        const heading = `What will you use ${modelDisplayName ?? 'this model'} for?`

        return h.view('connect/shared/details', {
          pageTitle: heading,
          heading,
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
          failAction: async (request, h, error) => {
            const pendingAccess = getPendingAccess(request)
            const modelDisplayName = await getModelDisplayName(
              request,
              pendingAccess?.modelSlug
            )
            const heading = `What will you use ${modelDisplayName ?? 'this model'} for?`

            return h
              .view('connect/shared/details', {
                pageTitle: `Error: ${heading}`,
                heading,
                values: request.payload,
                errorSummary: buildDetailsErrorSummary(error, modelDisplayName),
                fieldErrors: buildDetailsFieldErrors(error, modelDisplayName)
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
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
          summaryRows: buildCheckAnswersRows(model, pendingAccess.purpose),
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
                summaryRows: buildCheckAnswersRows(
                  model,
                  pendingAccess.purpose
                ),
                purpose: pendingAccess.purpose,
                errorMessage: errorMessageForCode(error),
                errorAction:
                  error.code === 'active-credential-exists' ||
                  error.code === 'credential-expired-use-renew'
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
            ...issued,
            ...buildGatewayRequest(issued.model)
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

  if (error.code === 'credential-expired-use-renew') {
    return 'Your credential for this model has expired. Renew it instead of requesting a new one.'
  }

  if (error.code === 'model-not-eligible') {
    return 'This model is not available for the research tier.'
  }

  if (error.code === 'model-not-granted') {
    return 'You do not have access to this model.'
  }

  if (error.code === 'upstream-unavailable') {
    return 'We could not issue a credential right now. Please try again.'
  }

  return error.message
}

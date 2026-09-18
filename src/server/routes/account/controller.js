import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getSessionUser,
  setAccountNotification,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'

const revokeConfirmSchema = Joi.object({
  confirmRevoke: Joi.string().valid('yes', 'no').required().messages({
    'any.required': 'Select yes if you want to revoke this credential',
    'any.only': 'Select yes if you want to revoke this credential'
  })
})

// Only the credential's own model is looked up, so this stays a single call
// rather than fetching the whole catalogue for a one-row confirm page.
async function findModel(request, modelSlug) {
  return apiClient(request).get(`/v1/models/${modelSlug}`)
}

async function buildModelNameMap(request) {
  const { items } = await apiClient(request).get('/v1/models')

  return Object.fromEntries(
    items.map((model) => [model.slug, model.displayName])
  )
}

function isNotFound(error) {
  return error instanceof ApiError && error.statusCode === statusCodes.notFound
}

const TAG_CLASS_BY_STATUS = {
  active: 'govuk-tag--green',
  revoked: 'govuk-tag--red'
}

function tagClassForStatus(status) {
  return TAG_CLASS_BY_STATUS[status] ?? 'govuk-tag--grey'
}

// GOV.UK's notification banner macro only has a distinct "success" style;
// anything else renders its default (informational/error) style.
function notificationBannerParams(notification) {
  if (!notification) {
    return null
  }

  return {
    text: notification.message,
    ...(notification.type === 'success' ? { type: 'success' } : {})
  }
}

export const accountController = {
  list: {
    get: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const [{ items }, modelNames] = await Promise.all([
          apiClient(request).get('/v1/credentials', {
            userId: sessionUser.id
          }),
          buildModelNameMap(request)
        ])

        return h.view('account/index', {
          pageTitle: 'Your account',
          heading: 'Your account',
          credentials: items.map((credential) => ({
            ...credential,
            modelDisplayName:
              modelNames[credential.modelSlug] ?? credential.modelSlug,
            tagClass: tagClassForStatus(credential.status)
          })),
          notificationBanner: notificationBannerParams(
            takeAccountNotification(request)
          )
        })
      }
    }
  },

  renew: {
    post: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { id } = request.params

        try {
          const credential = await apiClient(request).post(
            `/v1/credentials/${id}/renew`,
            undefined,
            { userId: sessionUser.id }
          )

          setAccountNotification(request, {
            type: 'success',
            message: `Credential renewed. New expiry: ${credential.expiresAt}`
          })
        } catch (error) {
          if (!(error instanceof ApiError)) {
            throw error
          }

          if (!isNotFound(error)) {
            setAccountNotification(request, {
              type: 'error',
              message: error.message
            })
          }
        }

        return h.redirect('/account').code(statusCodes.seeOther)
      }
    }
  },

  revoke: {
    get: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { id } = request.params

        let credential
        try {
          credential = await apiClient(request).get(`/v1/credentials/${id}`, {
            userId: sessionUser.id
          })
        } catch (error) {
          if (isNotFound(error)) {
            return h.redirect('/account').code(statusCodes.seeOther)
          }
          throw error
        }

        const model = await findModel(request, credential.modelSlug)

        return h.view('account/revoke', {
          pageTitle: 'Confirm revoke',
          heading: 'Are you sure you want to revoke this credential?',
          credential,
          model,
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },

    post: {
      options: {
        validate: {
          payload: revokeConfirmSchema,
          failAction: async (request, h, error) => {
            const sessionUser = getSessionUser(request)
            const { id } = request.params
            const credential = await apiClient(request).get(
              `/v1/credentials/${id}`,
              { userId: sessionUser.id }
            )
            const model = await findModel(request, credential.modelSlug)

            return h
              .view('account/revoke', {
                pageTitle: 'Error: Confirm revoke',
                heading: 'Are you sure you want to revoke this credential?',
                credential,
                model,
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      async handler(request, h) {
        const { id } = request.params

        if (request.payload.confirmRevoke === 'yes') {
          const sessionUser = getSessionUser(request)

          try {
            await apiClient(request).del(`/v1/credentials/${id}`, {
              userId: sessionUser.id
            })

            setAccountNotification(request, {
              type: 'success',
              message: 'Credential revoked.'
            })
          } catch (error) {
            if (!(error instanceof ApiError) || !isNotFound(error)) {
              throw error
            }
          }
        }

        return h.redirect('/account').code(statusCodes.seeOther)
      }
    }
  }
}

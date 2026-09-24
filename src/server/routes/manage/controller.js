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

function decorateCredential(credential, modelNames) {
  return {
    ...credential,
    modelDisplayName: modelNames[credential.modelSlug] ?? credential.modelSlug,
    tagClass: tagClassForStatus(credential.status)
  }
}

// Builds each team's read-only credential listing for /manage (B09): every
// member sees the same shared team credential, with no renew/revoke/rotate
// actions yet - those are role-gated in Route 3's plan. Deployment requests
// that haven't produced a viewable credential yet (still being set up,
// failed, or active but not yet revealed to anyone) get a "check progress"
// row instead, so a request never becomes unreachable if the requester
// navigates away from the wait page.
const DEPLOYMENT_FAILURE_STATUSES = ['checks-failed', 'deploy-failed']

function deploymentStatusText(status) {
  if (status === 'active') {
    return 'Ready to view'
  }

  if (DEPLOYMENT_FAILURE_STATUSES.includes(status)) {
    return 'Setup failed'
  }

  return 'Setting up'
}

function deploymentTagClass(status) {
  if (status === 'active') {
    return 'govuk-tag--green'
  }

  if (DEPLOYMENT_FAILURE_STATUSES.includes(status)) {
    return 'govuk-tag--red'
  }

  return 'govuk-tag--yellow'
}

function decorateDeployment(deployment, modelNames) {
  return {
    ...deployment,
    modelDisplayName: modelNames[deployment.modelSlug] ?? deployment.modelSlug,
    statusText: deploymentStatusText(deployment.status),
    tagClass: deploymentTagClass(deployment.status),
    requestUrl: `/connect/team/request/${deployment.teamId}/${deployment._id}`
  }
}

function buildTeamSections(teamItems, credentials, deployments, modelNames) {
  return teamItems.map((team) => {
    const teamCredentials = credentials
      .filter((credential) => credential.teamId === team._id)
      .map((credential) => decorateCredential(credential, modelNames))

    const modelSlugsWithActiveCredential = new Set(
      teamCredentials
        .filter((credential) => credential.status === 'active')
        .map((credential) => credential.modelSlug)
    )

    const teamDeployments = deployments
      .filter((deployment) => deployment.teamId === team._id)
      .filter(
        (deployment) =>
          !(
            deployment.status === 'active' &&
            modelSlugsWithActiveCredential.has(deployment.modelSlug)
          )
      )
      .map((deployment) => decorateDeployment(deployment, modelNames))

    return {
      ...team,
      credentials: teamCredentials,
      deployments: teamDeployments
    }
  })
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

export const manageController = {
  list: {
    get: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const [{ items }, modelNames, { items: teamItems }] = await Promise.all(
          [
            apiClient(request).get('/v1/credentials', {
              userId: sessionUser.id
            }),
            buildModelNameMap(request),
            apiClient(request).get('/v1/teams', { userId: sessionUser.id })
          ]
        )

        const deployments = (
          await Promise.all(
            teamItems.map((team) =>
              apiClient(request).get(`/v1/teams/${team._id}/deployments`, {
                userId: sessionUser.id
              })
            )
          )
        ).flatMap((response) => response.items)

        const personalCredentials = items.filter(
          (credential) => !credential.teamId
        )

        return h.view('manage/index', {
          pageTitle: 'Manage AI access',
          heading: 'Manage AI access',
          credentials: personalCredentials.map((credential) =>
            decorateCredential(credential, modelNames)
          ),
          teams: buildTeamSections(teamItems, items, deployments, modelNames),
          notificationBanner: notificationBannerParams(
            takeAccountNotification(request)
          )
        })
      }
    }
  },

  view: {
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
            return h
              .view('error/index', {
                pageTitle: 'Credential not found',
                heading: 'Credential not found',
                message:
                  'This credential does not exist, or you do not have access to it.',
                actionHref: '/manage',
                actionText: 'Manage AI access'
              })
              .code(statusCodes.notFound)
          }
          throw error
        }

        const model = await findModel(request, credential.modelSlug)

        return h.view('manage/credential', {
          pageTitle: model.displayName,
          heading: model.displayName,
          credential,
          model
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

        return h.redirect('/manage').code(statusCodes.seeOther)
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
            return h.redirect('/manage').code(statusCodes.seeOther)
          }
          throw error
        }

        const model = await findModel(request, credential.modelSlug)

        return h.view('manage/revoke', {
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
              .view('manage/revoke', {
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

        return h.redirect('/manage').code(statusCodes.seeOther)
      }
    }
  }
}

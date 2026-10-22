import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { buildGatewayRequest } from '#/server/common/helpers/gateway-request.js'
import {
  getSessionUser,
  setAccountNotification,
  takeAccountNotification,
  setIssuedCredential,
  takeIssuedCredential
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  credentialEnvironment,
  credentialEnvironmentName
} from '#/server/common/helpers/environment-names.js'
import {
  revealSchema,
  revokeConfirmSchema
} from '#/server/common/helpers/credential-schemas.js'
import {
  buildKeyRows,
  buildModelRows,
  notificationBannerParams
} from './access-view.js'

// How often the page re-reads while any of the person's models is changing.
const MODELS_CHANGING_REFRESH_SECONDS = 5

const SECRET_NAME = 'key'
const TEAM_TIER = 'team'

// Only the credential's own model is looked up, so this stays a single call
// rather than fetching the whole catalogue for a one-row confirm page.
async function findModel(request, modelSlug) {
  return apiClient(request).get(`/v1/models/${modelSlug}`)
}

// A personal research key, or null when the id is not one of the person's
// keys. A team's client secret is the team's to manage, on the team's own
// routes, so it is not found here whatever the API would allow.
async function findResearchCredential(request, id) {
  let credential

  try {
    credential = await apiClient(request).get(`/v1/credentials/${id}`, {
      userId: getSessionUser(request).id
    })
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }

  return credential.tier === TEAM_TIER ? null : credential
}

// The words of the revoke confirmation: the key, and what revoking costs.
async function revokeContent(request, credential) {
  const model = await findModel(request, credential.modelSlug)

  return {
    heading: 'Are you sure you want to revoke this credential?',
    warning: `Revoking ${model.displayName} cannot be undone. You will need to connect again to get a new credential.`,
    legend: 'Are you sure you want to revoke this credential?',
    yesText: 'Yes, revoke this credential',
    noText: 'No, take me back to your access'
  }
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

        // Deployment listings are supplementary: a transient failure on one
        // team must not take down the whole Manage page.
        const deploymentResults = await Promise.allSettled(
          teamItems.map((team) =>
            apiClient(request).get(`/v1/teams/${team._id}/deployments`, {
              userId: sessionUser.id
            })
          )
        )

        const deployments = deploymentResults.flatMap((result) => {
          if (result.status === 'rejected') {
            request.logger.warn(
              { err: result.reason },
              'Could not load team deployments for the manage page'
            )
            return []
          }

          return result.value.items
        })

        // teamId is stamped at issue time from the user's team and can go
        // stale if they later change teams; tier is the reliable signal for
        // personal vs shared, since teamId is never used for authorization.
        const teamsById = new Map(teamItems.map((team) => [team._id, team]))
        const modelRows = buildModelRows(
          deployments,
          items,
          teamsById,
          modelNames
        )

        return h.view('manage/index', {
          pageTitle: 'Your access',
          heading: 'Your access',
          keyRows: buildKeyRows(items, modelNames),
          modelRows,
          modelsUnavailable: deploymentResults.some(
            (result) => result.status === 'rejected'
          ),
          teams: teamItems,
          notificationBanner: notificationBannerParams(
            takeAccountNotification(request)
          ),
          refreshSeconds: modelRows.some((row) => row.inProgress)
            ? MODELS_CHANGING_REFRESH_SECONDS
            : undefined
        })
      }
    }
  },

  view: {
    get: {
      async handler(request, h) {
        const { id } = request.params
        const credential = await findResearchCredential(request, id)

        if (!credential) {
          return h
            .view('error/index', {
              pageTitle: 'Credential not found',
              heading: 'Credential not found',
              message:
                'This credential does not exist, or you do not have access to it.',
              actionHref: '/manage',
              actionText: 'Go to your access'
            })
            .code(statusCodes.notFound)
        }

        const model = await findModel(request, credential.modelSlug)
        const heading = model.displayName

        return h.view('manage/credential', {
          pageTitle: heading,
          heading,
          credential,
          environmentName: credentialEnvironmentName(credential),
          models: [
            {
              ...model,
              gatewayEndpoint: buildGatewayRequest(
                model,
                credentialEnvironment(credential)
              ).endpoint
            }
          ]
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
        const credential = await findResearchCredential(
          request,
          request.params.id
        )

        if (!credential) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        return h.view('manage/revoke', {
          pageTitle: 'Confirm revoke',
          ...(await revokeContent(request, credential)),
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
            const credential = await findResearchCredential(
              request,
              request.params.id
            )

            if (!credential) {
              return h.redirect('/manage').code(statusCodes.seeOther).takeover()
            }

            return h
              .view('manage/revoke', {
                pageTitle: 'Error: Confirm revoke',
                ...(await revokeContent(request, credential)),
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
          if (!(await findResearchCredential(request, id))) {
            return h.redirect('/manage').code(statusCodes.seeOther)
          }

          try {
            await apiClient(request).del(`/v1/credentials/${id}`, {
              userId: getSessionUser(request).id
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
  },

  reveal: {
    get: {
      async handler(request, h) {
        const credential = await findResearchCredential(
          request,
          request.params.id
        )

        if (!credential) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        const model = await findModel(request, credential.modelSlug)

        return h.view('manage/reveal', {
          pageTitle: `View the full ${SECRET_NAME}`,
          heading: `View the full ${SECRET_NAME} for ${model.displayName}`,
          secretName: SECRET_NAME,
          values: { reason: '' },
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },

    post: {
      options: {
        validate: {
          payload: revealSchema,
          failAction: async (request, h, error) => {
            const credential = await findResearchCredential(
              request,
              request.params.id
            )

            if (!credential) {
              return h.redirect('/manage').code(statusCodes.seeOther).takeover()
            }

            const model = await findModel(request, credential.modelSlug)

            return h
              .view('manage/reveal', {
                pageTitle: `Error: View the full ${SECRET_NAME}`,
                heading: `View the full ${SECRET_NAME} for ${model.displayName}`,
                secretName: SECRET_NAME,
                values: request.payload,
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
        const credential = await findResearchCredential(request, id)

        if (!credential) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        try {
          const { secret } = await apiClient(request).post(
            `/v1/credentials/${id}/reveal`,
            { reason: request.payload.reason },
            { userId: getSessionUser(request).id }
          )

          setIssuedCredential(request, {
            secret,
            credentialId: id,
            secretName: SECRET_NAME
          })

          return h
            .redirect(`/manage/credentials/${id}/revealed`)
            .code(statusCodes.seeOther)
        } catch (error) {
          if (!(error instanceof ApiError)) {
            throw error
          }

          setAccountNotification(request, {
            type: 'error',
            message:
              error.code === 'credential-revoked'
                ? 'This credential has been revoked.'
                : 'This credential could not be found.'
          })

          return h.redirect('/manage').code(statusCodes.seeOther)
        }
      }
    }
  },

  revealed: {
    get: {
      handler(request, h) {
        const issued = takeIssuedCredential(request)

        // The slot is shared with a team's secrets, which are shown only
        // on the team's own routes.
        if (
          !issued ||
          issued.credentialId !== request.params.id ||
          issued.secretName !== SECRET_NAME
        ) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        return h
          .view('manage/revealed', {
            pageTitle: `Your ${issued.secretName}`,
            heading: `Your ${issued.secretName}`,
            secretName: issued.secretName,
            secret: issued.secret,
            returnHref: `/manage/credentials/${issued.credentialId}`,
            returnText: 'Back to this credential'
          })
          .header('cache-control', 'no-store')
      }
    }
  }
}

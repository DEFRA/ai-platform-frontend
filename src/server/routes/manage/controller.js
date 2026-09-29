import Joi from 'joi'
import { differenceInCalendarDays } from 'date-fns'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
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
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { formatLabel } from '#/config/nunjucks/filters/format-label.js'

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

// A team credential can cover several models (`allowedDeployments`); a
// research credential always has exactly one (`modelSlug`).
async function findModelsForCredential(request, credential) {
  if (credential.tier === 'team') {
    const slugs = credential.allowedDeployments ?? []

    return Promise.all(slugs.map((slug) => findModel(request, slug)))
  }

  return [await findModel(request, credential.modelSlug)]
}

function modelNamesText(models) {
  return models.map((model) => model.displayName).join(', ') || 'this model'
}

// The signed-in user's role for one team credential - looked up from the
// same `GET /v1/teams` list `/manage` already uses, so a single-credential
// page (not already holding the team list) can still role-gate its actions.
// Research credentials are self-service regardless of their `teamId`, so
// this is only ever consulted for `tier === 'team'`.
async function isTeamAdmin(request, sessionUser, teamId) {
  if (!teamId) {
    return false
  }

  const { items } = await apiClient(request).get('/v1/teams', {
    userId: sessionUser.id
  })

  return items.find((team) => team._id === teamId)?.role === 'admin'
}

// Best-effort team name lookup for the rotate confirmation page's heading -
// falls back to a generic label rather than failing the page if it can't
// be resolved (mirrors getModelDisplayName's pattern in connect/controller.js).
async function findTeamName(request, sessionUser, teamId) {
  if (!teamId) {
    return undefined
  }

  const { items } = await apiClient(request).get('/v1/teams', {
    userId: sessionUser.id
  })

  return items.find((team) => team._id === teamId)?.name
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

function modelDisplayNameFor(credential, modelNames) {
  if (credential.tier === 'team') {
    const slugs = credential.allowedDeployments ?? []

    return slugs.length > 0
      ? slugs.map((slug) => modelNames[slug] ?? slug).join(', ')
      : 'No models yet'
  }

  return modelNames[credential.modelSlug] ?? credential.modelSlug
}

// Research keys carry a fixed, meaningful expiry - show a countdown instead
// of a static "Active" tag so people notice one is about to run out.
const RESEARCH_EXPIRY_WARNING_DAYS = 3

function statusDisplayFor(credential) {
  if (credential.tier === 'team' || credential.status !== 'active') {
    return {
      text: formatLabel(credential.status),
      tagClass: tagClassForStatus(credential.status)
    }
  }

  const daysLeft = Math.max(
    differenceInCalendarDays(new Date(credential.expiresAt), new Date()),
    0
  )

  return {
    text: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
    tagClass:
      daysLeft <= RESEARCH_EXPIRY_WARNING_DAYS
        ? 'govuk-tag--yellow'
        : 'govuk-tag--green'
  }
}

function decorateKeyRow(credential, modelNames, { forText, showRenewRevoke, isAdmin }) {
  const statusDisplay = statusDisplayFor(credential)

  return {
    ...credential,
    modelDisplayName: modelDisplayNameFor(credential, modelNames),
    forText,
    environment: 'Sandbox',
    statusText: statusDisplay.text,
    tagClass: statusDisplay.tagClass,
    runsOut: credential.expiresAt ? formatDate(credential.expiresAt) : null,
    showRenewRevoke,
    showRotateRevoke: credential.tier === 'team' && isAdmin
  }
}

// Builds the single "Keys you can use" table (page 11): personal research
// keys and shared team keys side by side, so people can compare what they
// hold without switching tabs.
function buildKeyRows(credentials, teamsById, modelNames) {
  return credentials.map((credential) => {
    if (credential.tier === 'team') {
      const team = teamsById.get(credential.teamId)

      return decorateKeyRow(credential, modelNames, {
        forText: `${team?.name ?? 'Unknown team'} / Team`,
        showRenewRevoke: false,
        isAdmin: team?.role === 'admin'
      })
    }

    return decorateKeyRow(credential, modelNames, {
      forText: 'You / Research',
      showRenewRevoke: true,
      isAdmin: false
    })
  })
}

// Deployment requests that haven't produced a viewable credential yet (still
// being set up, failed, or active but not yet revealed to anyone) get a
// "check progress" row, so a request never becomes unreachable if the
// requester navigates away from the wait page. A model whose credential was
// ever actually issued (active or later revoked) has already been through
// that flow - keep it out permanently so revoking a credential doesn't
// resurrect its request row and let "check progress" issue a brand new one.
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

function buildIssuedModelSlugsByTeam(teamCredentials) {
  const issuedByTeam = new Map()

  for (const credential of teamCredentials) {
    if (!['active', 'revoked'].includes(credential.status)) {
      continue
    }

    const slugs = issuedByTeam.get(credential.teamId) ?? new Set()
    for (const slug of credential.allowedDeployments ?? []) {
      slugs.add(slug)
    }
    issuedByTeam.set(credential.teamId, slugs)
  }

  return issuedByTeam
}

function buildBeingSetUpRows(deployments, teamCredentials, teamsById, modelNames) {
  const issuedModelSlugsByTeam = buildIssuedModelSlugsByTeam(teamCredentials)

  return deployments
    .filter(
      (deployment) =>
        !issuedModelSlugsByTeam.get(deployment.teamId)?.has(deployment.modelSlug)
    )
    .map((deployment) => ({
      ...deployment,
      modelDisplayName: modelNames[deployment.modelSlug] ?? deployment.modelSlug,
      forText: teamsById.get(deployment.teamId)?.name ?? 'Unknown team',
      statusText: deploymentStatusText(deployment.status),
      tagClass: deploymentTagClass(deployment.status),
      requestUrl: `/connect/team/request/${deployment.teamId}/${deployment._id}`
    }))
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
        const teamCredentials = items.filter(
          (credential) => credential.tier === 'team'
        )

        const hasInProgressDeployment = deployments.some(
          (deployment) =>
            !DEPLOYMENT_FAILURE_STATUSES.includes(deployment.status) &&
            deployment.status !== 'active'
        )

        return h.view('manage/index', {
          pageTitle: 'Your access',
          heading: 'Your access',
          keyRows: buildKeyRows(items, teamsById, modelNames),
          beingSetUpRows: buildBeingSetUpRows(
            deployments,
            teamCredentials,
            teamsById,
            modelNames
          ),
          teams: teamItems,
          notificationBanner: notificationBannerParams(
            takeAccountNotification(request)
          ),
          refreshSeconds: hasInProgressDeployment ? 5 : undefined
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
                actionText: 'Go to your access'
              })
              .code(statusCodes.notFound)
          }
          throw error
        }

        const models = await findModelsForCredential(request, credential)
        const isAdmin =
          credential.tier === 'team'
            ? await isTeamAdmin(request, sessionUser, credential.teamId)
            : false
        const heading =
          credential.tier === 'team' ? 'Team credential' : models[0].displayName

        return h.view('manage/credential', {
          pageTitle: heading,
          heading,
          credential,
          models,
          isAdmin
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

        const models = await findModelsForCredential(request, credential)

        return h.view('manage/revoke', {
          pageTitle: 'Confirm revoke',
          heading: 'Are you sure you want to revoke this credential?',
          credential,
          modelNamesText: modelNamesText(models),
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
            const models = await findModelsForCredential(request, credential)

            return h
              .view('manage/revoke', {
                pageTitle: 'Error: Confirm revoke',
                heading: 'Are you sure you want to revoke this credential?',
                credential,
                modelNamesText: modelNamesText(models),
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
            if (error instanceof ApiError && error.code === 'admin-required') {
              setAccountNotification(request, {
                type: 'error',
                message: 'Only a team admin can revoke this credential.'
              })
              return h.redirect('/manage').code(statusCodes.seeOther)
            }

            if (!(error instanceof ApiError) || !isNotFound(error)) {
              throw error
            }
          }
        }

        return h.redirect('/manage').code(statusCodes.seeOther)
      }
    }
  },

  rotate: {
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

        const models = await findModelsForCredential(request, credential)
        const teamName = await findTeamName(
          request,
          sessionUser,
          credential.teamId
        )

        return h.view('manage/rotate', {
          pageTitle: 'Confirm rotate',
          heading: `Are you sure you want to rotate the ${teamName ?? 'team'} key?`,
          credential,
          modelNamesText: modelNamesText(models),
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
            const models = await findModelsForCredential(request, credential)
            const teamName = await findTeamName(
              request,
              sessionUser,
              credential.teamId
            )

            return h
              .view('manage/rotate', {
                pageTitle: 'Error: Confirm rotate',
                heading: `Are you sure you want to rotate the ${teamName ?? 'team'} key?`,
                credential,
                modelNamesText: modelNamesText(models),
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

        if (request.payload.confirmRevoke !== 'yes') {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        const sessionUser = getSessionUser(request)

        try {
          const { credential, secret } = await apiClient(request).post(
            `/v1/credentials/${id}/rotate`,
            undefined,
            { userId: sessionUser.id }
          )

          const models = await findModelsForCredential(request, credential)

          setIssuedCredential(request, {
            credential,
            secret,
            modelNamesText: modelNamesText(models)
          })

          return h
            .redirect(`/manage/credentials/${id}/rotated`)
            .code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError && error.code === 'admin-required') {
            setAccountNotification(request, {
              type: 'error',
              message: 'Only a team admin can rotate this credential.'
            })
            return h.redirect('/manage').code(statusCodes.seeOther)
          }

          if (!(error instanceof ApiError) || !isNotFound(error)) {
            throw error
          }

          return h.redirect('/manage').code(statusCodes.seeOther)
        }
      }
    }
  },

  rotated: {
    get: {
      handler(request, h) {
        const issued = takeIssuedCredential(request)

        if (!issued) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        return h
          .view('manage/rotated', {
            pageTitle: 'Credential rotated',
            heading: 'Credential rotated',
            credential: issued.credential,
            secret: issued.secret,
            modelNamesText: issued.modelNamesText
          })
          .header('cache-control', 'no-store')
      }
    }
  }
}

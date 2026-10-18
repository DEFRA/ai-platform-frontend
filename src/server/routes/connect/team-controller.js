import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getSessionUser,
  getPendingAccess,
  setPendingAccess,
  takeIssuedCredential,
  setAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import {
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS
} from '#/server/common/helpers/deployment-status.js'
import {
  errorMessageForCode,
  issueTeamClientSecret
} from './team-client-secret.js'
import {
  environmentHint,
  environmentItems,
  environmentValues
} from './team-environments.js'
import {
  FAILURE_STATUSES,
  IN_PROGRESS_STATUSES,
  QUEUED_STATUS,
  buildPipelineLinks,
  waitPageHeading
} from './team-request-view.js'

// The team journey needs both a chosen team and a chosen model. Without the
// teamId a shared-flow session would fall through to /v1/teams/undefined/....
function hasTeamJourneyState(pendingAccess) {
  return Boolean(
    pendingAccess?.modelSlug &&
    pendingAccess?.teamId &&
    pendingAccess?.accessType === 'team'
  )
}

const selectTeamSchema = Joi.object({
  teamId: Joi.string().required().messages({
    'any.required': 'Select a team'
  })
})

const selectModelSchema = Joi.object({
  modelSlug: Joi.string().required().messages({
    'any.required': 'Select a model'
  })
})

const detailsSchema = Joi.object({
  purpose: Joi.string().trim().max(500).allow('').optional().messages({
    'string.max': 'Purpose must be 500 characters or fewer'
  }),
  environment: Joi.string()
    .valid(...environmentValues())
    .default(environmentValues()[0])
    .messages({ 'any.only': 'Select an available environment' })
})

function redirectToStart(h) {
  return h.redirect('/connect').takeover()
}

function buildTeamItems(teamsList, selectedTeamId) {
  return teamsList.map((team) => ({
    value: team._id,
    text: team.name,
    checked: team._id === selectedTeamId
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

export const teamConnectController = {
  selectTeam: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (pendingAccess?.accessType !== 'team') {
          return redirectToStart(h)
        }

        const sessionUser = getSessionUser(request)
        const { items } = await apiClient(request).get('/v1/teams', {
          userId: sessionUser.id
        })

        if (items.length === 0) {
          return h
            .redirect('/teams/new?returnTo=%2Fconnect%2Fteam%2Fselect')
            .code(statusCodes.seeOther)
        }

        return h.view('connect/team/select', {
          pageTitle: 'Choose a team',
          heading: 'Which team is this for?',
          teamItems: buildTeamItems(items, pendingAccess.teamId),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: selectTeamSchema,
          failAction: async (request, h, error) => {
            const sessionUser = getSessionUser(request)
            const { items } = await apiClient(request).get('/v1/teams', {
              userId: sessionUser.id
            })

            return h
              .view('connect/team/select', {
                pageTitle: 'Error: Choose a team',
                heading: 'Which team is this for?',
                teamItems: buildTeamItems(items, request.payload.teamId),
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

        if (pendingAccess?.accessType !== 'team') {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          teamId: request.payload.teamId
        })

        return h.redirect('/connect/team/model').code(statusCodes.seeOther)
      }
    }
  },

  selectModel: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.teamId) {
          return redirectToStart(h)
        }

        const { items } = await apiClient(request).get('/v1/models?tier=team')

        return h.view('connect/shared/model', {
          pageTitle: 'Choose a model',
          heading: 'Which model do you want to connect to?',
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
              '/v1/models?tier=team'
            )

            return h
              .view('connect/shared/model', {
                pageTitle: 'Error: Choose a model',
                heading: 'Which model do you want to connect to?',
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

        if (!pendingAccess?.teamId) {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          modelSlug: request.payload.modelSlug
        })

        return h.redirect('/connect/team/details').code(statusCodes.seeOther)
      }
    }
  },

  details: {
    get: {
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        return h.view('connect/team/details', {
          pageTitle: 'Say what it is for',
          heading: 'Say what it is for',
          values: { purpose: pendingAccess.purpose ?? '' },
          environmentItems: environmentItems(),
          environmentHint: environmentHint(),
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
              .view('connect/team/details', {
                pageTitle: 'Error: Say what it is for',
                heading: 'Say what it is for',
                values: request.payload,
                environmentItems: environmentItems(),
                environmentHint: environmentHint(),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
        }
      },
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          purpose: request.payload.purpose ?? '',
          environment: request.payload.environment
        })

        return h.redirect('/connect/team/check').code(statusCodes.seeOther)
      }
    }
  },

  check: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        const model = await apiClient(request).get(
          `/v1/models/${pendingAccess.modelSlug}`
        )

        return h.view('connect/team/check', {
          pageTitle: 'Check your answers',
          heading: 'Check your answers',
          model,
          purpose: pendingAccess.purpose,
          environment: pendingAccess.environment,
          errorMessage: null,
          existingRequestUrl: null
        })
      }
    },
    post: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)
        const sessionUser = getSessionUser(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        // Session can legitimately expire mid-journey, same as Route 1's
        // shared flow: send the person back to the start.
        if (!sessionUser) {
          return redirectToStart(h)
        }

        try {
          const { deployment } = await apiClient(request).post(
            `/v1/teams/${pendingAccess.teamId}/deployments`,
            {
              modelSlug: pendingAccess.modelSlug,
              environment: pendingAccess.environment
            },
            { userId: sessionUser.id, idempotencyKey: randomUUID() }
          )

          return h
            .redirect(
              `/connect/team/request/${pendingAccess.teamId}/${deployment._id}`
            )
            .code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError) {
            const model = await apiClient(request).get(
              `/v1/models/${pendingAccess.modelSlug}`
            )

            const existingRequestUrl =
              error.code === 'deployment-exists' && error.existingId
                ? `/connect/team/request/${pendingAccess.teamId}/${error.existingId}`
                : null

            return h
              .view('connect/team/check', {
                pageTitle: 'Check your answers',
                heading: 'Check your answers',
                model,
                purpose: pendingAccess.purpose,
                environment: pendingAccess.environment,
                errorMessage: errorMessageForCode(error),
                existingRequestUrl
              })
              .code(error.statusCode)
          }

          throw error
        }
      }
    }
  },

  request: {
    get: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)

        if (!sessionUser) {
          return redirectToStart(h)
        }

        const { teamId, id } = request.params

        let deployment
        try {
          ;({ deployment } = await apiClient(request).get(
            `/v1/teams/${teamId}/deployments/${id}`,
            { userId: sessionUser.id }
          ))
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.statusCode === statusCodes.notFound
          ) {
            return h
              .view('error/index', {
                pageTitle: 'Request not found',
                heading: 'Request not found',
                message:
                  'This request does not exist, or you are not a member of this team.',
                actionHref: '/manage',
                actionText: 'Go to your access'
              })
              .code(statusCodes.notFound)
          }

          throw error
        }

        if (
          deployment.status === DEPLOYMENT_REMOVING_STATUS ||
          deployment.status === DEPLOYMENT_REMOVED_STATUS
        ) {
          return h.redirect(`/teams/${teamId}`).code(statusCodes.seeOther)
        }

        if (IN_PROGRESS_STATUSES.includes(deployment.status)) {
          const heading = waitPageHeading(deployment.status)

          return h.view('connect/team/request', {
            pageTitle: heading,
            heading,
            queued: deployment.status === QUEUED_STATUS,
            refreshSeconds: 3,
            lastCheckedAt: formatDate(new Date(), 'HH:mm'),
            failed: false,
            stages: deployment.progressSteps,
            pipelineLinks: buildPipelineLinks(deployment.links)
          })
        }

        if (FAILURE_STATUSES.includes(deployment.status)) {
          return h.view('connect/team/request', {
            pageTitle: "We could not set up your team's access",
            heading: "We could not set up your team's access",
            refreshSeconds: null,
            failed: true,
            stages: [],
            failureReason: deployment.failureReason ?? null,
            pipelineLinks: buildPipelineLinks(deployment.links)
          })
        }

        // Only the member who requested the deployment may trigger issuance and
        // see the one-time secret. Everyone else gets the read-only /manage view.
        if (deployment.requestedBy !== sessionUser.id) {
          setAccountNotification(request, {
            type: 'success',
            message:
              "Your team's model is ready to use - see it below. Ask the person who requested it for the connection details."
          })

          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        return issueTeamClientSecret(request, h, {
          sessionUser,
          teamId,
          deployment
        })
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

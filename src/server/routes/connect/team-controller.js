import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getSessionUser,
  getPendingAccess,
  setPendingAccess,
  setIssuedCredential,
  takeIssuedCredential,
  setAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'

// Only `dev` is available today (B09) - every design C environment is shown
// so the option isn't a surprise later, but only `dev` is enabled, matching
// the backend's `environment-not-available` policy for anything else.
const ENVIRONMENT_ITEMS = [
  { value: 'dev', text: 'Development (dev)', checked: true },
  {
    value: 'qa',
    text: 'QA',
    disabled: true,
    hint: { text: 'Not available yet.' }
  },
  {
    value: 'preprod',
    text: 'Pre-production',
    disabled: true,
    hint: { text: 'Not available yet.' }
  },
  {
    value: 'prod',
    text: 'Production',
    disabled: true,
    hint: { text: 'Not available yet.' }
  }
]

// The wait page groups every intermediate GitOps state into one friendly
// "being set up" message - it never shows raw GitOps jargon to the user (B09).
const IN_PROGRESS_STATUSES = [
  'requested',
  'pr-raised',
  'merged',
  'deploying',
  'deployed',
  'verified'
]
const FAILURE_STATUSES = ['checks-failed', 'deploy-failed']

// Friendly, non-jargon progress stages shown on the wait page - each maps to
// one or more of design C's real GitOps states, never shown to the user directly.
const STAGE_GROUPS = [
  { label: 'Reviewing your request', statuses: ['requested', 'pr-raised'] },
  {
    label: "Setting up your team's dedicated model",
    statuses: ['merged', 'deploying', 'deployed']
  },
  { label: 'Running final checks', statuses: ['verified'] }
]

function buildStageProgress(status) {
  const currentIndex = STAGE_GROUPS.findIndex((stage) =>
    stage.statuses.includes(status)
  )

  return STAGE_GROUPS.map((stage, index) => ({
    label: stage.label,
    state:
      index < currentIndex
        ? 'done'
        : index === currentIndex
          ? 'current'
          : 'pending'
  }))
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
  environment: Joi.string().valid('dev').default('dev')
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

function errorMessageForCode(error) {
  if (error.code === 'deployment-exists') {
    return 'A deployment for this team and model already exists.'
  }

  if (error.code === 'model-not-eligible') {
    return 'This model is not available for your team.'
  }

  if (error.code === 'environment-not-available') {
    return 'This environment is not available yet.'
  }

  return error.message
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

        if (!pendingAccess?.modelSlug) {
          return redirectToStart(h)
        }

        return h.view('connect/team/details', {
          pageTitle: 'Say what it is for',
          heading: 'Say what it is for',
          values: { purpose: pendingAccess.purpose ?? '' },
          environmentItems: ENVIRONMENT_ITEMS,
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
                environmentItems: ENVIRONMENT_ITEMS,
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
          purpose: request.payload.purpose ?? '',
          environment: 'dev'
        })

        return h.redirect('/connect/team/check').code(statusCodes.seeOther)
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

        if (!pendingAccess?.modelSlug) {
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
            { userId: sessionUser.id }
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
                actionText: 'Manage AI access'
              })
              .code(statusCodes.notFound)
          }

          throw error
        }

        if (IN_PROGRESS_STATUSES.includes(deployment.status)) {
          return h.view('connect/team/request', {
            pageTitle: "Setting up your team's access",
            heading: "Setting up your team's access",
            refreshSeconds: 3,
            failed: false,
            stages: buildStageProgress(deployment.status)
          })
        }

        if (FAILURE_STATUSES.includes(deployment.status)) {
          return h.view('connect/team/request', {
            pageTitle: "We could not set up your team's access",
            heading: "We could not set up your team's access",
            refreshSeconds: null,
            failed: true,
            stages: []
          })
        }

        // status is 'active': issue (or reuse) the shared team credential.
        // Deployment fields (not session) are the source of truth here, so
        // this page works even after the session's pendingAccess is gone -
        // e.g. reached via a "check progress" link from /manage.
        const { credential, secret } = await apiClient(request).post(
          '/v1/credentials',
          {
            modelSlug: deployment.modelSlug,
            tier: 'team',
            teamId,
            environment: deployment.environment
          },
          { userId: sessionUser.id, idempotencyKey: randomUUID() }
        )

        if (!secret) {
          // Already issued and shown once to whoever triggered it originally -
          // nothing new to reveal. /manage always lists the team's credential
          // (key hint only).
          setAccountNotification(request, {
            type: 'success',
            message: "Your team's model is ready to use - see it below."
          })

          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        const model = await apiClient(request).get(
          `/v1/models/${deployment.modelSlug}`
        )

        setIssuedCredential(request, { credential, secret, model })

        return h.redirect('/connect/team/credential').code(statusCodes.seeOther)
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

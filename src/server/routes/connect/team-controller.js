import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  clearPendingAccess,
  getSessionUser,
  setPendingAccess,
  setRequestedDeployments
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  defaultTeamEnvironment,
  environmentName
} from '#/server/common/helpers/environment-names.js'
import { errorMessageForCode } from './team-client-secret.js'
import {
  MAX_MODELS_PER_REQUEST,
  hasCompletedTeamJourney,
  hasTeamJourneyState,
  preselectedModelSlugs,
  teamJourneyOf
} from './team-journey.js'
import {
  buildModelCheckboxes,
  loadModelChoices,
  unavailableSlugs
} from './team-model-choices.js'

const selectTeamSchema = Joi.object({
  teamId: Joi.string().required().messages({
    'any.required': 'Select a team'
  })
})

// One ticked box posts a string, several post a list; both become a list.
const selectModelsSchema = Joi.object({
  modelSlugs: Joi.array()
    .items(Joi.string().pattern(/^[a-z0-9-]+$/))
    .single()
    .unique()
    .min(1)
    .max(MAX_MODELS_PER_REQUEST)
    .required()
    .messages({
      'any.required': 'Select at least one model',
      'array.min': 'Select at least one model',
      'array.max': `Select no more than ${MAX_MODELS_PER_REQUEST} models`,
      'array.unique': 'Select each model only once',
      'string.pattern.base': 'Select models from the list'
    })
})

const detailsSchema = Joi.object({
  purpose: Joi.string().trim().max(500).allow('').optional().messages({
    'string.max': 'Purpose must be 500 characters or fewer'
  })
})

function redirectToStart(h) {
  return h.redirect('/connect').takeover()
}

// No environment is configured for teams to deploy to, so there is nothing
// to state or save on the details step: say so rather than lose the journey.
function environmentUnavailableView(h) {
  return h
    .view('error/index', {
      pageTitle: 'No environment is available yet',
      heading: 'No environment is available yet',
      message:
        'Models cannot be set up for a team in any environment yet. Try again later.',
      actionHref: '/models',
      actionText: 'Browse models'
    })
    .code(statusCodes.serviceUnavailable)
}

function buildTeamItems(teamsList, selectedTeamId) {
  return teamsList.map((team) => ({
    value: team._id,
    text: team.name,
    checked: team._id === selectedTeamId
  }))
}

// The slugs a posted model form names, whatever its shape.
function postedSlugs(payload) {
  return [].concat(payload?.modelSlugs ?? []).filter(Boolean)
}

function modelStepView(h, choices, selected, problem = {}) {
  return h.view('connect/team/model', {
    pageTitle: `${problem.errorSummary ? 'Error: ' : ''}Choose your models`,
    heading: 'Which models do you want to connect to?',
    modelItems: buildModelCheckboxes(choices, selected),
    errorSummary: problem.errorSummary ?? null,
    fieldErrors: problem.fieldErrors ?? {}
  })
}

async function checkAnswersView(request, h, pendingAccess, problem = {}) {
  const models = await Promise.all(
    pendingAccess.modelSlugs.map((slug) =>
      apiClient(request).get(`/v1/models/${slug}`)
    )
  )

  return h.view('connect/team/check', {
    pageTitle: 'Check your answers',
    heading: 'Check your answers',
    models,
    purpose: pendingAccess.purpose,
    environment: pendingAccess.environment,
    errorMessage: problem.errorMessage ?? null,
    existingRequestUrl: problem.existingRequestUrl ?? null
  })
}

export const teamConnectController = {
  selectTeam: {
    get: {
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

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
        const pendingAccess = teamJourneyOf(request)

        if (pendingAccess?.accessType !== 'team') {
          return redirectToStart(h)
        }

        // From here the journey belongs to this person (teamJourneyOf).
        setPendingAccess(request, {
          ...pendingAccess,
          teamId: request.payload.teamId,
          userId: getSessionUser(request).id
        })

        return h.redirect('/connect/team/model').code(statusCodes.seeOther)
      }
    }
  },

  selectModels: {
    get: {
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (!pendingAccess?.teamId) {
          return redirectToStart(h)
        }

        const choices = await loadModelChoices(request, pendingAccess.teamId)

        return modelStepView(h, choices, preselectedModelSlugs(pendingAccess))
      }
    },
    post: {
      options: {
        validate: {
          payload: selectModelsSchema,
          failAction: async (request, h, error) => {
            const pendingAccess = teamJourneyOf(request)

            if (!pendingAccess?.teamId) {
              return redirectToStart(h)
            }

            const choices = await loadModelChoices(
              request,
              pendingAccess.teamId
            )

            return modelStepView(h, choices, postedSlugs(request.payload), {
              errorSummary: buildErrorSummary(error),
              fieldErrors: buildFieldErrors(error)
            })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (!pendingAccess?.teamId) {
          return redirectToStart(h)
        }

        const { modelSlugs } = request.payload
        const choices = await loadModelChoices(request, pendingAccess.teamId)

        // The form only posts what it offered; anything else is a stale page
        // (a model the team has since been given) or a forged request.
        if (unavailableSlugs(choices, modelSlugs).length > 0) {
          const text = 'Select models from the list'

          return modelStepView(h, choices, modelSlugs, {
            errorSummary: [{ text, href: '#modelSlugs' }],
            fieldErrors: { modelSlugs: { text } }
          }).code(statusCodes.badRequest)
        }

        // `modelSlug` was only where the person came from; their choice replaces it.
        const { modelSlug, ...journey } = pendingAccess

        setPendingAccess(request, { ...journey, modelSlugs })

        return h.redirect('/connect/team/details').code(statusCodes.seeOther)
      }
    }
  },

  details: {
    get: {
      handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        if (!defaultTeamEnvironment()) {
          return environmentUnavailableView(h)
        }

        return h.view('connect/team/details', {
          pageTitle: 'Say what it is for',
          heading: 'Say what it is for',
          values: { purpose: pendingAccess.purpose ?? '' },
          environmentName: environmentName(defaultTeamEnvironment()),
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
            (defaultTeamEnvironment()
              ? h
                  .view('connect/team/details', {
                    pageTitle: 'Error: Say what it is for',
                    heading: 'Say what it is for',
                    values: request.payload,
                    environmentName: environmentName(defaultTeamEnvironment()),
                    errorSummary: buildErrorSummary(error),
                    fieldErrors: buildFieldErrors(error)
                  })
                  .code(statusCodes.badRequest)
              : environmentUnavailableView(h)
            ).takeover()
        }
      },
      handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        if (!defaultTeamEnvironment()) {
          return environmentUnavailableView(h)
        }

        // A fresh key for each time the answers are confirmed from here: a
        // double click on "Confirm" replays one request, a changed answer
        // makes a new one.
        setPendingAccess(request, {
          ...pendingAccess,
          purpose: request.payload.purpose ?? '',
          environment: defaultTeamEnvironment(),
          requestKey: randomUUID()
        })

        return h.redirect('/connect/team/check').code(statusCodes.seeOther)
      }
    }
  },

  check: {
    get: {
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (!hasCompletedTeamJourney(pendingAccess)) {
          return redirectToStart(h)
        }

        return checkAnswersView(request, h, pendingAccess)
      }
    },
    post: {
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)
        const sessionUser = getSessionUser(request)

        if (!hasCompletedTeamJourney(pendingAccess)) {
          return redirectToStart(h)
        }

        // Session can legitimately expire mid-journey, same as Route 1's
        // shared flow: send the person back to the start.
        if (!sessionUser) {
          return redirectToStart(h)
        }

        const { teamId, modelSlugs, environment, requestKey } = pendingAccess

        try {
          const { deployments } = await apiClient(request).post(
            `/v1/teams/${teamId}/deployments`,
            { modelSlugs, environment },
            { userId: sessionUser.id, idempotencyKey: requestKey }
          )

          // Made: the journey is over, and its answers must not seed the next.
          setRequestedDeployments(request, {
            teamId,
            ids: deployments.map(({ _id }) => _id)
          })
          clearPendingAccess(request)

          return h
            .redirect(`/connect/team/request/${teamId}/${deployments[0]._id}`)
            .code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError) {
            const existingRequestUrl =
              error.code === 'deployment-exists' && error.existingId
                ? `/connect/team/request/${teamId}/${error.existingId}`
                : null

            return (
              await checkAnswersView(request, h, pendingAccess, {
                errorMessage: errorMessageForCode(error),
                existingRequestUrl
              })
            ).code(error.statusCode)
          }

          throw error
        }
      }
    }
  }
}

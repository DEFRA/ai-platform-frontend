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
import {
  MAX_MODELS_PER_REQUEST,
  changeQuerySchema,
  hasCompletedTeamJourney,
  hasTeamJourneyState,
  isChange,
  preselectedModelSlugs,
  stepUrl,
  teamJourneyOf
} from './team-journey.js'
import {
  CREATE_TEAM_VALUE,
  buildTeamItems,
  loadTeamChoices
} from './team-choices.js'
import {
  buildModelCheckboxes,
  joinNames,
  loadModelChoices,
  notInUkSentence,
  pickableSlugs,
  unavailableSlugs
} from './team-model-choices.js'

const SELECT_URL = '/connect/team/select'
const MODEL_URL = '/connect/team/model'
const DETAILS_URL = '/connect/team/details'
const CHECK_URL = '/connect/team/check'
const NEW_TEAM_URL = `/teams/new?returnTo=${encodeURIComponent(SELECT_URL)}`

const SELECT_HEADING = 'Which team is this for?'
const MODEL_HEADING = 'Which models does your team need?'
const DETAILS_HEADING = 'What will your team use it for? (optional)'

const querySchema = { query: changeQuerySchema }

const selectTeamSchema = Joi.object({
  team: Joi.string()
    .pattern(/^([a-z0-9-]+|\+create)$/)
    .required()
    .messages({
      'any.required': 'Select a team',
      'string.empty': 'Select a team',
      'string.pattern.base': 'Select a team from the list'
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

function errorMessageForCode(error) {
  if (error.code === 'deployment-exists') {
    return 'Your team already has one of these models.'
  }

  if (error.code === 'model-not-eligible') {
    return 'One of these models is not available for your team.'
  }

  if (error.code === 'model-not-granted') {
    return 'Your team does not have access to one of these models.'
  }

  if (error.code === 'environment-not-available') {
    return 'This environment is not available yet.'
  }

  return error.message
}

function redirectToStart(h) {
  return h.redirect('/models').takeover()
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

// The previous step of the journey, or the check page for a step opened from
// "Change" there. The model step is skipped when one model came from its
// page, so the details step goes back past it.
const BACK_LINKS = {
  select: (pendingAccess) =>
    pendingAccess.modelSlug ? `/models/${pendingAccess.modelSlug}` : '/models',
  model: () => SELECT_URL,
  details: (pendingAccess) =>
    pendingAccess.modelStepSkipped ? SELECT_URL : MODEL_URL
}

function backHref(step, pendingAccess, change) {
  // The check page only takes a person back once every answer is there: after
  // changing the team the models are asked for again.
  return change && hasCompletedTeamJourney(pendingAccess)
    ? CHECK_URL
    : BACK_LINKS[step](pendingAccess)
}

// A form of a step posts back to its own address, `?change=check` included.
function selectView(h, { teams, pendingAccess, change, problem = {} }) {
  return h.view('connect/team/select', {
    pageTitle: `${problem.errorSummary ? 'Error: ' : ''}${SELECT_HEADING}`,
    heading: SELECT_HEADING,
    backLink: backHref('select', pendingAccess, change),
    teamItems: buildTeamItems(teams, pendingAccess.teamSlug),
    errorSummary: problem.errorSummary ?? null,
    fieldErrors: problem.fieldErrors ?? {}
  })
}

function modelStepView(
  h,
  { choices, selected, pendingAccess, change, problem = {} }
) {
  return h.view('connect/team/model', {
    pageTitle: `${problem.errorSummary ? 'Error: ' : ''}${MODEL_HEADING}`,
    heading: MODEL_HEADING,
    teamName: pendingAccess.teamName,
    backLink: backHref('model', pendingAccess, change),
    modelItems: buildModelCheckboxes(choices, selected),
    notInUkText: notInUkSentence(choices.notInUkNames),
    errorSummary: problem.errorSummary ?? null,
    fieldErrors: problem.fieldErrors ?? {}
  })
}

function detailsView(h, { pendingAccess, change, values, problem = {} }) {
  return h.view('connect/team/details', {
    pageTitle: `${problem.errorSummary ? 'Error: ' : ''}${DETAILS_HEADING}`,
    heading: DETAILS_HEADING,
    teamName: pendingAccess.teamName,
    backLink: backHref('details', pendingAccess, change),
    values,
    environmentName: environmentName(defaultTeamEnvironment()),
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
    teamName: pendingAccess.teamName,
    backLink: DETAILS_URL,
    teamChangeUrl: stepUrl(SELECT_URL, true),
    modelsChangeUrl: stepUrl(MODEL_URL, true),
    purposeChangeUrl: stepUrl(DETAILS_URL, true),
    modelNames: joinNames(models.map(({ displayName }) => displayName)),
    models,
    purpose: pendingAccess.purpose,
    environmentName: environmentName(pendingAccess.environment),
    errorMessage: problem.errorMessage ?? null,
    existingRequestUrl: problem.existingRequestUrl ?? null
  })
}

// The team a person chose, as the backend knows it. A team the person does
// not belong to is the same answer as one that does not exist.
async function findChosenTeam(request, slug) {
  try {
    const { team } = await apiClient(request).get(
      `/v1/teams/${encodeURIComponent(slug)}`,
      { userId: getSessionUser(request).id }
    )

    return team
  } catch (error) {
    if (
      error instanceof ApiError &&
      [statusCodes.forbidden, statusCodes.notFound].includes(error.statusCode)
    ) {
      return null
    }

    throw error
  }
}

function modelEnvironment(pendingAccess) {
  return pendingAccess.environment ?? defaultTeamEnvironment()
}

function loadChoicesFor(request, pendingAccess) {
  return loadModelChoices(request, {
    teamSlug: pendingAccess.teamSlug,
    environment: modelEnvironment(pendingAccess)
  })
}

// A model a person came to from its page is the whole choice when it is the
// only one on offer, so the step is skipped.
function isSingleModelFromItsPage(pendingAccess, choices) {
  const pickable = pickableSlugs(choices)

  return (
    !pendingAccess.modelSlugs?.length &&
    pickable.length === 1 &&
    pendingAccess.modelSlug === pickable[0]
  )
}

export const teamConnectController = {
  selectTeam: {
    get: {
      options: { validate: querySchema },
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (pendingAccess?.accessType !== 'team') {
          return redirectToStart(h)
        }

        const teams = await loadTeamChoices(request, defaultTeamEnvironment())

        if (teams.length === 0) {
          return h.redirect(NEW_TEAM_URL).code(statusCodes.seeOther)
        }

        return selectView(h, {
          teams,
          pendingAccess,
          change: isChange(request)
        })
      }
    },
    post: {
      options: {
        validate: {
          ...querySchema,
          payload: selectTeamSchema,
          failAction: async (request, h, error) => {
            const pendingAccess = teamJourneyOf(request)

            if (pendingAccess?.accessType !== 'team') {
              return redirectToStart(h)
            }

            const teams = await loadTeamChoices(
              request,
              defaultTeamEnvironment()
            )

            return selectView(h, {
              teams,
              pendingAccess,
              change: isChange(request),
              problem: {
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              }
            })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (pendingAccess?.accessType !== 'team') {
          return redirectToStart(h)
        }

        // A new team comes back listed, not chosen.
        if (request.payload.team === CREATE_TEAM_VALUE) {
          setPendingAccess(request, {
            ...pendingAccess,
            teamSlug: undefined,
            teamName: undefined,
            userId: getSessionUser(request).id
          })

          return h.redirect(NEW_TEAM_URL).code(statusCodes.seeOther)
        }

        const team = await findChosenTeam(request, request.payload.team)

        if (!team) {
          const text = 'Select a team from the list'
          const teams = await loadTeamChoices(request, defaultTeamEnvironment())

          return selectView(h, {
            teams,
            pendingAccess,
            change: isChange(request),
            problem: {
              errorSummary: [{ text, href: '#team' }],
              fieldErrors: { team: { text } }
            }
          }).code(statusCodes.badRequest)
        }

        // Another team has other models and its own deployments, so the
        // models are chosen again. From here the journey belongs to this
        // person (teamJourneyOf).
        const sameTeam = pendingAccess.teamSlug === team.slug
        const { modelSlugs, modelStepSkipped, ...rest } = pendingAccess

        setPendingAccess(request, {
          ...(sameTeam ? pendingAccess : rest),
          teamSlug: team.slug,
          teamName: team.name,
          userId: getSessionUser(request).id
        })

        if (sameTeam && isChange(request)) {
          return h.redirect(CHECK_URL).code(statusCodes.seeOther)
        }

        return h
          .redirect(stepUrl(MODEL_URL, isChange(request)))
          .code(statusCodes.seeOther)
      }
    }
  },

  selectModels: {
    get: {
      options: { validate: querySchema },
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (!pendingAccess?.teamSlug) {
          return redirectToStart(h)
        }

        const choices = await loadChoicesFor(request, pendingAccess)
        const change = isChange(request)

        if (!change && isSingleModelFromItsPage(pendingAccess, choices)) {
          const { modelSlug, ...journey } = pendingAccess

          setPendingAccess(request, {
            ...journey,
            modelSlugs: pickableSlugs(choices),
            modelStepSkipped: true
          })

          return h.redirect(DETAILS_URL).code(statusCodes.seeOther)
        }

        return modelStepView(h, {
          choices,
          selected: preselectedModelSlugs(pendingAccess),
          pendingAccess,
          change
        })
      }
    },
    post: {
      options: {
        validate: {
          ...querySchema,
          payload: selectModelsSchema,
          failAction: async (request, h, error) => {
            const pendingAccess = teamJourneyOf(request)

            if (!pendingAccess?.teamSlug) {
              return redirectToStart(h)
            }

            const choices = await loadChoicesFor(request, pendingAccess)

            return modelStepView(h, {
              choices,
              selected: [].concat(request.payload?.modelSlugs ?? []),
              pendingAccess,
              change: isChange(request),
              problem: {
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              }
            })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      async handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (!pendingAccess?.teamSlug) {
          return redirectToStart(h)
        }

        const { modelSlugs } = request.payload
        const choices = await loadChoicesFor(request, pendingAccess)
        const change = isChange(request)

        // The form only posts what it offered; anything else is a stale page
        // (a model the team has since been given) or a forged request.
        if (unavailableSlugs(choices, modelSlugs).length > 0) {
          const text = 'Select models from the list'

          return modelStepView(h, {
            choices,
            selected: modelSlugs,
            pendingAccess,
            change,
            problem: {
              errorSummary: [{ text, href: '#modelSlugs' }],
              fieldErrors: { modelSlugs: { text } }
            }
          }).code(statusCodes.badRequest)
        }

        // `modelSlug` was only where the person came from; their choice replaces it.
        const { modelSlug, ...journey } = pendingAccess

        // From the check page the answers are already complete, so the new
        // models need only a fresh key: a changed answer makes a new request.
        setPendingAccess(request, {
          ...journey,
          modelSlugs,
          modelStepSkipped: false,
          ...(change && { requestKey: randomUUID() })
        })

        return h
          .redirect(change ? CHECK_URL : DETAILS_URL)
          .code(statusCodes.seeOther)
      }
    }
  },

  details: {
    get: {
      options: { validate: querySchema },
      handler(request, h) {
        const pendingAccess = teamJourneyOf(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        if (!defaultTeamEnvironment()) {
          return environmentUnavailableView(h)
        }

        return detailsView(h, {
          pendingAccess,
          change: isChange(request),
          values: { purpose: pendingAccess.purpose ?? '' }
        })
      }
    },
    post: {
      options: {
        validate: {
          ...querySchema,
          payload: detailsSchema,
          failAction: (request, h, error) => {
            const pendingAccess = teamJourneyOf(request)

            if (!hasTeamJourneyState(pendingAccess)) {
              return redirectToStart(h)
            }

            return (
              defaultTeamEnvironment()
                ? detailsView(h, {
                    pendingAccess,
                    change: isChange(request),
                    values: request.payload,
                    problem: {
                      errorSummary: buildErrorSummary(error),
                      fieldErrors: buildFieldErrors(error)
                    }
                  }).code(statusCodes.badRequest)
                : environmentUnavailableView(h)
            ).takeover()
          }
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
        // double click on "Request access" replays one request, a changed
        // answer makes a new one.
        setPendingAccess(request, {
          ...pendingAccess,
          purpose: request.payload.purpose ?? '',
          environment: defaultTeamEnvironment(),
          requestKey: randomUUID()
        })

        return h.redirect(CHECK_URL).code(statusCodes.seeOther)
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

        // Session can legitimately expire mid-journey, same as the shared
        // flow: send the person back to the start.
        if (!sessionUser) {
          return redirectToStart(h)
        }

        const { teamSlug, modelSlugs, environment, requestKey } = pendingAccess

        try {
          const { deployments } = await apiClient(request).post(
            `/v1/teams/${encodeURIComponent(teamSlug)}/deployments`,
            { modelSlugs, environment },
            { userId: sessionUser.id, idempotencyKey: requestKey }
          )

          // Made: the journey is over, and its answers must not seed the next.
          setRequestedDeployments(request, {
            teamSlug,
            ids: deployments.map(({ _id }) => _id)
          })
          clearPendingAccess(request)

          return h
            .redirect(
              `/connect/team/request/${encodeURIComponent(teamSlug)}/${deployments[0]._id}`
            )
            .code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError) {
            const existingRequestUrl =
              error.code === 'deployment-exists' && error.existingId
                ? `/connect/team/request/${encodeURIComponent(teamSlug)}/${error.existingId}`
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

import { randomUUID } from 'node:crypto'

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
import { defaultTeamEnvironment } from '#/server/common/helpers/environment-names.js'
import {
  changeQuerySchema,
  hasCompletedTeamJourney,
  hasTeamJourneyState,
  isChange,
  preselectedModelSlugs,
  stepUrl,
  teamJourneyOf
} from './team-journey.js'
import { CREATE_TEAM_VALUE, loadTeamChoices } from './team-choices.js'
import { pickableSlugs, unavailableSlugs } from './team-model-choices.js'
import {
  detailsSchema,
  selectModelsSchema,
  selectTeamSchema
} from './team-schemas.js'
import {
  CHECK_URL,
  DETAILS_URL,
  MODEL_URL,
  NEW_TEAM_URL,
  checkAnswersView,
  detailsView,
  environmentUnavailableView,
  modelStepView,
  redirectToStart,
  selectView
} from './team-views.js'
import {
  findChosenTeam,
  isSingleModelFromItsPage,
  loadChoicesFor
} from './team-loaders.js'

const querySchema = { query: changeQuerySchema }

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
            teamSlug: null,
            teamName: null,
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
          setPendingAccess(request, {
            ...pendingAccess,
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
              selected: [request.payload?.modelSlugs ?? []].flat(),
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

        // `modelSlug` stays: it is where the person came from, which the Back
        // link of the team step goes back to, and the choice made here takes
        // precedence over it (preselectedModelSlugs).
        //
        // From the check page the answers are already complete, so the new
        // models need only a fresh key: a changed answer makes a new request.
        setPendingAccess(request, {
          ...pendingAccess,
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
          // Set up from another environment's page, the journey already
          // names the environment it is for.
          environment: pendingAccess.environment ?? defaultTeamEnvironment(),
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
            { idempotencyKey: requestKey }
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

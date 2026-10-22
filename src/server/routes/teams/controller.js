import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { safeReturnTo } from '#/server/common/helpers/safe-redirect.js'
import {
  getSessionUser,
  getPendingTeam,
  setPendingTeam,
  clearPendingTeam,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import { loadModelsTab } from './models-tab.js'
import { loadTeamRows } from './team-list.js'
import { descriptionField, serviceCodeField } from './team-fields.js'
import { deriveTeamSlug } from './team-slug.js'
import {
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamTabs,
  teamUrl
} from './team-view.js'

const newTeamSchema = Joi.object({
  name: Joi.string().trim().min(3).max(60).required().messages({
    'string.min': 'Team name must be 3 characters or more',
    'string.max': 'Team name must be 60 characters or fewer',
    'string.empty': 'Enter a team name',
    'any.required': 'Enter a team name'
  }),
  serviceCode: serviceCodeField,
  description: descriptionField,
  // Same-origin paths only - this value is redirected to after team creation.
  returnTo: Joi.string()
    .pattern(/^\/(?![/\\])[\w\-/%?=&.#]*$/)
    .allow('')
    .optional()
})

function errorMessageForCode(error) {
  if (error.code === 'team-exists') {
    return 'A team with this name already exists.'
  }

  return error.message
}

// Back from the form goes to where it was opened from: a step of a request
// journey, or the list of teams.
function newTeamBackUrl(returnTo) {
  return safeReturnTo(returnTo, '/teams')
}

function checkView(h, { pendingTeam, errorMessage = null }) {
  return h.view('teams/check', {
    pageTitle: `${errorMessage ? 'Error: ' : ''}Check your answers`,
    heading: 'Check your answers',
    pendingTeam,
    teamId: deriveTeamSlug(pendingTeam.name),
    errorMessage
  })
}

export const teamsController = {
  list: {
    get: {
      async handler(request, h) {
        return h.view('teams/index', {
          pageTitle: 'Teams',
          heading: 'Teams',
          notification: takeAccountNotification(request),
          teams: await loadTeamRows(request)
        })
      }
    }
  },

  newTeam: {
    get: {
      handler(request, h) {
        const pendingTeam = getPendingTeam(request) ?? {}

        return h.view('teams/new', {
          pageTitle: 'Create a team',
          heading: 'Create a team',
          values: {
            name: pendingTeam.name ?? '',
            serviceCode: pendingTeam.serviceCode ?? '',
            description: pendingTeam.description ?? ''
          },
          returnTo: safeReturnTo(
            request.query.returnTo ?? pendingTeam.returnTo,
            ''
          ),
          backUrl: newTeamBackUrl(
            request.query.returnTo ?? pendingTeam.returnTo
          ),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: newTeamSchema,
          failAction: (request, h, error) =>
            h
              .view('teams/new', {
                pageTitle: 'Error: Create a team',
                heading: 'Create a team',
                values: request.payload,
                returnTo: request.payload.returnTo ?? '',
                backUrl: newTeamBackUrl(request.payload.returnTo),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
        }
      },
      handler(request, h) {
        const { name, serviceCode, description, returnTo } = request.payload

        setPendingTeam(request, {
          name,
          serviceCode,
          description: description || undefined,
          returnTo: returnTo || undefined
        })

        return h.redirect('/teams/new/check').code(statusCodes.seeOther)
      }
    }
  },

  check: {
    get: {
      handler(request, h) {
        const pendingTeam = getPendingTeam(request)

        if (!pendingTeam?.name) {
          return h.redirect('/teams/new').code(statusCodes.seeOther)
        }

        return checkView(h, { pendingTeam })
      }
    },
    post: {
      async handler(request, h) {
        const pendingTeam = getPendingTeam(request)
        const sessionUser = getSessionUser(request)

        if (!pendingTeam?.name) {
          return h.redirect('/teams/new').code(statusCodes.seeOther)
        }

        if (!sessionUser) {
          return h.redirect('/models').code(statusCodes.seeOther)
        }

        try {
          const { team } = await apiClient(request).post(
            '/v1/teams',
            {
              name: pendingTeam.name,
              serviceCode: pendingTeam.serviceCode,
              description: pendingTeam.description
            },
            { userId: sessionUser.id, idempotencyKey: randomUUID() }
          )

          clearPendingTeam(request)

          if (pendingTeam.returnTo) {
            // Back to the journey it came from, which lists the new team.
            return h
              .redirect(safeReturnTo(pendingTeam.returnTo, teamUrl(team)))
              .code(statusCodes.seeOther)
          }

          return h
            .redirect(`${teamUrl(team)}/members`)
            .code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError) {
            return checkView(h, {
              pendingTeam,
              errorMessage: errorMessageForCode(error)
            }).code(error.statusCode)
          }

          throw error
        }
      }
    }
  },

  team: {
    get: {
      async handler(request, h) {
        let loaded
        try {
          loaded = await loadTeamForView(request, request.params.slug)
        } catch (error) {
          if (isNotFound(error)) {
            return teamNotFoundView(h)
          }

          throw error
        }

        const { team, isAdmin, environments } = loaded
        const tab = await loadModelsTab(request, {
          team,
          isAdmin,
          environments
        })

        return h.view('teams/team', {
          pageTitle: team.name,
          heading: team.name,
          team,
          teamUrl: teamUrl(team),
          tabs: teamTabs(team, 'models'),
          notification: takeAccountNotification(request),
          ...tab
        })
      }
    }
  }
}

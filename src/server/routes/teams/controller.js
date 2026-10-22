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
  setAccountNotification,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import { loadModelsTab } from './models-tab.js'
import { loadTeamRows } from './team-list.js'
import {
  isForbidden,
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamTabs,
  teamUrl
} from './team-view.js'

const serviceCodeField = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9]{3}$/)
  .required()
  .messages({
    'string.pattern.base':
      'Service code must be 3 letters or numbers, for example AIP',
    'string.empty': 'Enter your service code',
    'any.required': 'Enter your service code'
  })

const newTeamSchema = Joi.object({
  name: Joi.string().trim().min(3).max(60).required().messages({
    'string.min': 'Team name must be 3 characters or more',
    'string.max': 'Team name must be 60 characters or fewer',
    'any.required': 'Enter a team name'
  }),
  serviceCode: serviceCodeField,
  description: Joi.string().trim().max(500).allow('').optional(),
  // Same-origin paths only - this value is redirected to after team creation.
  returnTo: Joi.string()
    .pattern(/^\/(?![/\\])[\w\-/%?=&.#]*$/)
    .allow('')
    .optional()
})

const serviceCodeSchema = Joi.object({ serviceCode: serviceCodeField })

function errorMessageForCode(error) {
  if (error.code === 'team-exists') {
    return 'A team with this name already exists.'
  }

  return error.message
}

// A form that has failed validation goes back to the team: the page has no
// form for it (step 10 gives it its own page), so only a request made by
// hand gets here.
function backToTeam(request, h) {
  return h
    .redirect(`/teams/${encodeURIComponent(request.params.slug)}`)
    .code(statusCodes.seeOther)
    .takeover()
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

        return h.view('teams/check', {
          pageTitle: 'Check your answers',
          heading: 'Check your answers',
          pendingTeam,
          errorMessage: null
        })
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

          return h.redirect(teamUrl(team)).code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError) {
            return h
              .view('teams/check', {
                pageTitle: 'Check your answers',
                heading: 'Check your answers',
                pendingTeam,
                errorMessage: errorMessageForCode(error)
              })
              .code(error.statusCode)
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
  },

  setServiceCode: {
    post: {
      options: {
        validate: {
          payload: serviceCodeSchema,
          failAction: backToTeam
        }
      },
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { slug } = request.params

        try {
          await apiClient(request).patch(
            `/v1/teams/${encodeURIComponent(slug)}`,
            { serviceCode: request.payload.serviceCode },
            { userId: sessionUser.id }
          )
          setAccountNotification(request, {
            type: 'success',
            message: 'Service code updated.'
          })
        } catch (error) {
          if (!(error instanceof ApiError) || !isForbidden(error)) {
            throw error
          }
        }

        return h.redirect(teamUrl({ slug })).code(statusCodes.seeOther)
      }
    }
  }
}

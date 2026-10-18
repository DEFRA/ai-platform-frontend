import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { safeReturnTo } from '#/server/common/helpers/safe-redirect.js'
import {
  getSessionUser,
  getPendingAccess,
  setPendingAccess,
  getPendingTeam,
  setPendingTeam,
  clearPendingTeam,
  getCurrentTeamId,
  setCurrentTeamId,
  setAccountNotification,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  TEAM_VIEW,
  isForbidden,
  isNotFound,
  loadTeamForView,
  loadTeamModels,
  teamPageContext
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

const memberRoleSchema = Joi.object({
  role: Joi.string().valid('admin', 'user').required()
})

const addMemberSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Enter a valid email address',
    'any.required': 'Enter an email address'
  })
})

function errorMessageForCode(error) {
  if (error.code === 'team-exists') {
    return 'A team with this name already exists.'
  }

  return error.message
}

// A member change the backend refused: the last-admin rule becomes a banner,
// a refusal or a missing member is silent, and anything else is a fault.
function handleMemberChangeError(request, error) {
  if (!(error instanceof ApiError)) {
    throw error
  }

  if (error.code === 'last-admin') {
    setAccountNotification(request, {
      type: 'error',
      message: 'A team must keep at least one admin.'
    })
    return
  }

  if (!isForbidden(error) && !isNotFound(error)) {
    throw error
  }
}

// The team page again with the errors of a form on it, and what the person
// typed still in that form: the saved service code stays in the summary,
// the attempted one in the input.
async function rerenderTeamPage(request, h, error) {
  const { id } = request.params
  const result = await loadTeamForView(request, id)
  const listing = await loadTeamModels(request, id, result.isAdmin)
  const attempted = request.payload?.serviceCode

  return h
    .view(
      TEAM_VIEW,
      teamPageContext(result, listing, {
        errorSummary: buildErrorSummary(error),
        fieldErrors: buildFieldErrors(error),
        ...(typeof attempted === 'string' && { serviceCodeValue: attempted })
      })
    )
    .code(statusCodes.badRequest)
    .takeover()
}

export const teamsController = {
  list: {
    get: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { items } = await apiClient(request).get('/v1/teams', {
          userId: sessionUser.id
        })
        const currentTeamId = getCurrentTeamId(request)

        return h.view('teams/index', {
          pageTitle: 'Your teams',
          heading: 'Your teams',
          teams: items.map((team) => ({
            ...team,
            isCurrent: team._id === currentTeamId
          }))
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
          return h.redirect('/connect').code(statusCodes.seeOther)
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
            const currentAccess = getPendingAccess(request) ?? {}

            setPendingAccess(request, {
              ...currentAccess,
              accessType: 'team',
              teamId: team._id
            })

            return h
              .redirect(
                safeReturnTo(pendingTeam.returnTo, `/teams/${team._id}`)
              )
              .code(statusCodes.seeOther)
          }

          return h.redirect(`/teams/${team._id}`).code(statusCodes.seeOther)
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
        const { id } = request.params

        let result
        try {
          result = await loadTeamForView(request, id)
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.statusCode === statusCodes.notFound
          ) {
            return h
              .view('error/index', {
                pageTitle: 'Team not found',
                heading: 'Team not found',
                message: 'This team does not exist, or you are not a member.'
              })
              .code(statusCodes.notFound)
          }

          throw error
        }

        // Opening a team is what makes it the one you are acting in.
        setCurrentTeamId(request, id)

        const listing = await loadTeamModels(request, id, result.isAdmin)

        return h.view(
          TEAM_VIEW,
          teamPageContext(result, listing, {
            notification: takeAccountNotification(request)
          })
        )
      }
    }
  },

  setMemberRole: {
    post: {
      options: {
        validate: {
          payload: memberRoleSchema,
          failAction: (request, h) =>
            h
              .redirect(`/teams/${request.params.id}`)
              .code(statusCodes.seeOther)
              .takeover()
        }
      },
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { id, memberId } = request.params

        try {
          await apiClient(request).patch(
            `/v1/teams/${id}/members/${memberId}`,
            { role: request.payload.role },
            { userId: sessionUser.id }
          )
        } catch (error) {
          handleMemberChangeError(request, error)
        }

        return h.redirect(`/teams/${id}`).code(statusCodes.seeOther)
      }
    }
  },

  addMember: {
    post: {
      options: {
        validate: {
          payload: addMemberSchema,
          failAction: rerenderTeamPage
        }
      },
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { id } = request.params

        try {
          await apiClient(request).post(
            `/v1/teams/${id}/members`,
            { email: request.payload.email },
            { userId: sessionUser.id, idempotencyKey: randomUUID() }
          )
        } catch (error) {
          if (!(error instanceof ApiError) || !isForbidden(error)) {
            throw error
          }
        }

        return h.redirect(`/teams/${id}`).code(statusCodes.seeOther)
      }
    }
  },

  setServiceCode: {
    post: {
      options: {
        validate: {
          payload: serviceCodeSchema,
          failAction: rerenderTeamPage
        }
      },
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { id } = request.params

        try {
          await apiClient(request).patch(
            `/v1/teams/${id}`,
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

        return h.redirect(`/teams/${id}`).code(statusCodes.seeOther)
      }
    }
  },

  removeMember: {
    post: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { id, memberId } = request.params

        try {
          await apiClient(request).del(`/v1/teams/${id}/members/${memberId}`, {
            userId: sessionUser.id
          })
        } catch (error) {
          handleMemberChangeError(request, error)
        }

        return h.redirect(`/teams/${id}`).code(statusCodes.seeOther)
      }
    }
  }
}

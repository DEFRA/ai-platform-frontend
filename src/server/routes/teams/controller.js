import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getSessionUser,
  getPendingAccess,
  setPendingAccess,
  getPendingTeam,
  setPendingTeam,
  clearPendingTeam
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'

const newTeamSchema = Joi.object({
  name: Joi.string().trim().min(3).max(60).required().messages({
    'string.min': 'Team name must be 3 characters or more',
    'string.max': 'Team name must be 60 characters or fewer',
    'any.required': 'Enter a team name'
  }),
  serviceCode: Joi.string().trim().max(20).allow('').optional(),
  description: Joi.string().trim().max(500).allow('').optional(),
  returnTo: Joi.string().allow('').optional()
})

const addMemberSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Enter a valid email address',
    'any.required': 'Enter an email address'
  })
})

function isForbidden(error) {
  return (
    error instanceof ApiError && error.statusCode === statusCodes.forbidden
  )
}

function errorMessageForCode(error) {
  if (error.code === 'team-exists') {
    return 'A team with this name already exists.'
  }

  return error.message
}

async function loadTeamForView(request, id) {
  const sessionUser = getSessionUser(request)
  const result = await apiClient(request).get(`/v1/teams/${id}`, {
    userId: sessionUser.id
  })

  const isAdmin = result.members.some(
    (member) => member.userId === sessionUser.id && member.role === 'admin'
  )

  return { ...result, isAdmin }
}

export const teamsController = {
  list: {
    get: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { items } = await apiClient(request).get('/v1/teams', {
          userId: sessionUser.id
        })

        return h.view('teams/index', {
          pageTitle: 'Your teams',
          heading: 'Your teams',
          teams: items
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
          returnTo: request.query.returnTo ?? pendingTeam.returnTo ?? '',
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
          serviceCode: serviceCode || undefined,
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

            return h.redirect(pendingTeam.returnTo).code(statusCodes.seeOther)
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

        return h.view('teams/team', {
          pageTitle: result.team.name,
          heading: result.team.name,
          team: result.team,
          members: result.members,
          isAdmin: result.isAdmin,
          errorSummary: null,
          fieldErrors: {}
        })
      }
    }
  },

  addMember: {
    post: {
      options: {
        validate: {
          payload: addMemberSchema,
          failAction: async (request, h, error) => {
            const { id } = request.params
            const result = await loadTeamForView(request, id)

            return h
              .view('teams/team', {
                pageTitle: result.team.name,
                heading: result.team.name,
                team: result.team,
                members: result.members,
                isAdmin: result.isAdmin,
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { id } = request.params

        try {
          await apiClient(request).post(
            `/v1/teams/${id}/members`,
            { email: request.payload.email },
            { userId: sessionUser.id }
          )
        } catch (error) {
          if (!(error instanceof ApiError) || !isForbidden(error)) {
            throw error
          }
        }

        return h.redirect(`/teams/${id}`).code(statusCodes.seeOther)
      }
    }
  }
}

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
  deploymentStatusText,
  deploymentTagClass,
  isDeploymentInProgress
} from '#/server/common/helpers/deployment-status.js'

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

function isForbidden(error) {
  return error instanceof ApiError && error.statusCode === statusCodes.forbidden
}

function isNotFound(error) {
  return error instanceof ApiError && error.statusCode === statusCodes.notFound
}

function errorMessageForCode(error) {
  if (error.code === 'team-exists') {
    return 'A team with this name already exists.'
  }

  return error.message
}

// Only an admin needs to see a colleague's full address (to manage invites);
// everyone else gets a masked form so the page isn't a team-wide email list.
function maskEmail(email) {
  const [localPart, domain] = email.split('@')

  if (!domain) {
    return 'Hidden'
  }

  return `${localPart.slice(0, 1)}${'*'.repeat(Math.max(localPart.length - 1, 1))}@${domain}`
}

async function loadTeamForView(request, id) {
  const sessionUser = getSessionUser(request)
  const result = await apiClient(request).get(`/v1/teams/${id}`, {
    userId: sessionUser.id
  })

  const isAdmin = result.members.some(
    (member) =>
      member.userId === sessionUser.id &&
      member.role === 'admin' &&
      member.status === 'active'
  )

  const activeAdminCount = result.members.filter(
    (member) => member.role === 'admin' && member.status === 'active'
  ).length

  const members = result.members
    // Removed members are kept in the backend for audit purposes only.
    .filter((member) => member.status !== 'removed')
    .map((member) => ({
      ...member,
      email:
        member.email && !isAdmin && member.userId !== sessionUser.id
          ? maskEmail(member.email)
          : member.email,
      // The team's last admin can be neither removed nor demoted; promote
      // someone else first.
      canRemove: isAdmin && !(member.role === 'admin' && activeAdminCount <= 1),
      canChangeRole:
        isAdmin && !(member.role === 'admin' && activeAdminCount <= 1),
      nextRole: member.role === 'admin' ? 'user' : 'admin'
    }))

  return { ...result, members, isAdmin }
}

// The team's model deployments, as rows for the team page. Supplementary
// to the team itself: a failure to list them must not take the page down.
async function loadTeamModels(request, id, isAdmin) {
  const sessionUser = getSessionUser(request)
  const [deployments, catalogue] = await Promise.allSettled([
    apiClient(request).get(`/v1/teams/${id}/deployments`, {
      userId: sessionUser.id
    }),
    apiClient(request).get('/v1/models')
  ])

  if (deployments.status === 'rejected') {
    request.logger.warn(
      { err: deployments.reason },
      'Could not load the team models for the team page'
    )
    return []
  }

  const modelNames = Object.fromEntries(
    (catalogue.value?.items ?? []).map((model) => [
      model.slug,
      model.displayName
    ])
  )

  return (deployments.value?.items ?? []).map((deployment) => ({
    _id: deployment._id,
    modelSlug: deployment.modelSlug,
    modelDisplayName: modelNames[deployment.modelSlug] ?? deployment.modelSlug,
    environment: deployment.environment,
    status: deployment.status,
    statusText: deploymentStatusText(deployment.status),
    tagClass: deploymentTagClass(deployment.status),
    failureReason: deployment.failureReason ?? null,
    // Only an admin removes a model, and only one that is in place.
    canRemove: isAdmin && deployment.status === 'active',
    removeUrl: `/teams/${id}/models/${deployment._id}/remove`,
    requestUrl: `/connect/team/request/${id}/${deployment._id}`
  }))
}

// What every render of the team page needs.
function teamPageContext(result, models, extras) {
  return {
    pageTitle: result.team.name,
    heading: result.team.name,
    team: result.team,
    members: result.members,
    isAdmin: result.isAdmin,
    models,
    refreshSeconds: models.some((model) => isDeploymentInProgress(model.status))
      ? 5
      : undefined,
    notification: null,
    errorSummary: null,
    fieldErrors: {},
    ...extras
  }
}

function removeModelErrorMessage(error) {
  if (error.code === 'deployment-in-progress') {
    return 'This model is still being set up. Try again once it is ready.'
  }

  if (error.code === 'team-file-busy') {
    return 'Another change to this team is in progress. Try again in a few minutes.'
  }

  if (error.code === 'admin-required') {
    return 'Only a team admin can remove a model.'
  }

  return error.message
}

function modelNotFound(h, teamId) {
  return h
    .view('error/index', {
      pageTitle: 'Model not found',
      heading: 'Model not found',
      message:
        'This model is not one of this team’s, or you are not an admin of the team.',
      actionHref: `/teams/${teamId}`,
      actionText: 'Back to the team'
    })
    .code(statusCodes.notFound)
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

        const models = await loadTeamModels(request, id, result.isAdmin)

        return h.view(
          'teams/team',
          teamPageContext(result, models, {
            notification: takeAccountNotification(request)
          })
        )
      }
    }
  },

  removeModel: {
    get: {
      async handler(request, h) {
        const { id, deploymentId } = request.params
        const result = await loadTeamForView(request, id)
        const model = (await loadTeamModels(request, id, result.isAdmin)).find(
          (candidate) => candidate._id === deploymentId
        )

        if (!model || !result.isAdmin) {
          return modelNotFound(h, id)
        }

        return h.view('teams/remove-model', {
          pageTitle: `Remove ${model.modelDisplayName} from ${result.team.name}`,
          heading: `Remove ${model.modelDisplayName} from ${result.team.name}?`,
          team: result.team,
          model
        })
      }
    },
    post: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)
        const { id, deploymentId } = request.params

        try {
          const { deployment } = await apiClient(request).del(
            `/v1/teams/${id}/deployments/${deploymentId}`,
            { userId: sessionUser.id }
          )

          setAccountNotification(request, {
            type: 'success',
            message:
              deployment.status === 'removed'
                ? `${deployment.modelSlug} has been removed from the team.`
                : `${deployment.modelSlug} is being removed. Apps using it through your team’s address will stop working once it has gone; this takes a few minutes.`
          })
        } catch (error) {
          // Only a refusal the person can act on becomes a banner; a backend
          // fault goes to the error page like everywhere else.
          if (
            !(error instanceof ApiError) ||
            error.statusCode >= statusCodes.internalServerError
          ) {
            throw error
          }

          if (isNotFound(error)) {
            return modelNotFound(h, id)
          }

          setAccountNotification(request, {
            type: 'error',
            message: removeModelErrorMessage(error)
          })
        }

        return h.redirect(`/teams/${id}`).code(statusCodes.seeOther)
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
          if (!(error instanceof ApiError)) {
            throw error
          }

          if (error.code === 'last-admin') {
            setAccountNotification(request, {
              type: 'error',
              message: 'A team must keep at least one admin.'
            })
          } else if (!isForbidden(error) && !isNotFound(error)) {
            throw error
          }
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
          failAction: async (request, h, error) => {
            const { id } = request.params
            const result = await loadTeamForView(request, id)
            const models = await loadTeamModels(request, id, result.isAdmin)

            return h
              .view(
                'teams/team',
                teamPageContext(result, models, {
                  errorSummary: buildErrorSummary(error),
                  fieldErrors: buildFieldErrors(error)
                })
              )
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
          failAction: async (request, h, error) => {
            const { id } = request.params
            const result = await loadTeamForView(request, id)
            const models = await loadTeamModels(request, id, result.isAdmin)

            return h
              .view(
                'teams/team',
                teamPageContext(result, models, {
                  errorSummary: buildErrorSummary(error),
                  fieldErrors: buildFieldErrors(error)
                })
              )
              .code(statusCodes.badRequest)
              .takeover()
          }
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
          if (!(error instanceof ApiError)) {
            throw error
          }

          if (error.code === 'last-admin') {
            setAccountNotification(request, {
              type: 'error',
              message: 'A team must keep at least one admin.'
            })
          } else if (!isForbidden(error) && !isNotFound(error)) {
            throw error
          }
        }

        return h.redirect(`/teams/${id}`).code(statusCodes.seeOther)
      }
    }
  }
}

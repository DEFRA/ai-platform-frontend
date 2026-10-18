import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getSessionUser,
  setAccountNotification
} from '#/server/common/helpers/session.js'
import { isNotFound, loadTeamForView, loadTeamModels } from './team-view.js'

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

function removalNotification(deployment) {
  return deployment.status === 'removed'
    ? `${deployment.modelSlug} has been removed from the team.`
    : `${deployment.modelSlug} is being removed. Apps using it through your team’s address will stop working once it has gone; this takes a few minutes.`
}

/**
 * An admin removes one of the team's models: a confirm page, then the
 * backend takes the model out of the team file through GitOps.
 */
export const removeModelController = {
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
          message: removalNotification(deployment)
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
}

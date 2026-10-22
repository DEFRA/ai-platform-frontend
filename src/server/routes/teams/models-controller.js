import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getSessionUser,
  setAccountNotification
} from '#/server/common/helpers/session.js'
import {
  DEPLOYMENT_FAILURE_STATUSES,
  DEPLOYMENT_REMOVED_STATUS
} from '#/server/common/helpers/deployment-status.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import { isNotFound, loadTeamForView, teamUrl } from './team-view.js'

const ACTIVE_STATUS = 'active'

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

function modelNotFound(h, teamRef) {
  return h
    .view('error/index', {
      pageTitle: 'Model not found',
      heading: 'Model not found',
      message:
        'This model is not one of this team’s, or you are not an admin of the team.',
      actionHref: teamUrl({ slug: teamRef }),
      actionText: 'Back to the team'
    })
    .code(statusCodes.notFound)
}

// The model's display name for a heading, or its slug when the catalogue no
// longer lists it or cannot be read: a name is a nicety, never a reason to
// stop a removal or to fail after one.
async function modelDisplayName(request, modelSlug) {
  try {
    const model = await apiClient(request).get(
      `/v1/models/${encodeURIComponent(modelSlug)}`
    )

    return model.displayName ?? modelSlug
  } catch {
    return modelSlug
  }
}

// What a team's admin can remove: a model that is ready, or one that failed
// to set up.
function isRemovable(deployment) {
  return (
    deployment.status === ACTIVE_STATUS ||
    DEPLOYMENT_FAILURE_STATUSES.includes(deployment.status)
  )
}

// The team's deployment, or null when it is not one of the team's.
async function findDeployment(request, slug, deploymentId) {
  try {
    const { deployment } = await apiClient(request).get(
      `/v1/teams/${encodeURIComponent(slug)}/deployments/${encodeURIComponent(deploymentId)}`,
      { userId: getSessionUser(request).id }
    )

    return deployment
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }

    throw error
  }
}

function removalNotification(deployment, { name, environment }) {
  if (deployment.status === DEPLOYMENT_REMOVED_STATUS) {
    return {
      type: 'success',
      heading: `${name} has been removed from ${environment}`,
      message:
        'Apps using it through your team’s address no longer work with it.'
    }
  }

  return {
    type: 'success',
    heading: `${name} is being removed from ${environment}`,
    message:
      'Apps using it through your team’s address will stop working once it has gone. This takes a few minutes.'
  }
}

/**
 * An admin removes one of the team's models: a confirm page, then the
 * backend takes the model out of the team file through GitOps.
 */
export const removeModelController = {
  get: {
    async handler(request, h) {
      const { slug, deploymentId } = request.params
      let loaded

      try {
        loaded = await loadTeamForView(request, slug)
      } catch (error) {
        if (isNotFound(error)) {
          return modelNotFound(h, slug)
        }

        throw error
      }

      const deployment = await findDeployment(request, slug, deploymentId)

      if (!deployment || !loaded.isAdmin || !isRemovable(deployment)) {
        return modelNotFound(h, slug)
      }

      const name = await modelDisplayName(request, deployment.modelSlug)
      const environment = environmentName(deployment.environment)
      // A model that never finished setting up has nothing using it.
      const neverSetUp = DEPLOYMENT_FAILURE_STATUSES.includes(deployment.status)

      return h.view('teams/remove-model', {
        pageTitle: `Remove ${name} from ${environment}?`,
        heading: `Remove ${name} from ${environment}?`,
        team: loaded.team,
        teamUrl: teamUrl(loaded.team),
        modelName: name,
        warning: neverSetUp
          ? 'It was never set up, so nothing is using it.'
          : `Anything using ${name} through your team’s address will stop working as soon as it has been removed. Your team’s other models and its client secret are not affected.`
      })
    }
  },
  post: {
    async handler(request, h) {
      const sessionUser = getSessionUser(request)
      const { slug, deploymentId } = request.params

      try {
        const { deployment } = await apiClient(request).del(
          `/v1/teams/${encodeURIComponent(slug)}/deployments/${encodeURIComponent(deploymentId)}`,
          { userId: sessionUser.id }
        )

        setAccountNotification(
          request,
          removalNotification(deployment, {
            name: await modelDisplayName(request, deployment.modelSlug),
            environment: environmentName(deployment.environment)
          })
        )
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
          return modelNotFound(h, slug)
        }

        setAccountNotification(request, {
          type: 'error',
          message: removeModelErrorMessage(error)
        })
      }

      return h.redirect(teamUrl({ slug })).code(statusCodes.seeOther)
    }
  }
}

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import { adminDeploymentUrl } from './admin-page.js'
import { ACTION_NAMES, deploymentView } from './deployment.js'
import {
  deploymentNotFoundView,
  deploymentRefusalView,
  loadDeployment
} from './deployment-page.js'

// Retry and Reconcile for a change that holds no model: a federated
// application's change or a limits change. The backend recovers it by its
// operation; the page offers only the operations the deployment lists, so an
// address made up does not reach the backend, and the backend decides whether
// the change may be run.

const OPERATIONS_API = '/v1/admin/operations'
const NOT_RETRYABLE = 'operation-not-retryable'
const NOT_FOUND = 'operation-not-found'

// What the operation is for, as the page names it, and where on the page it is.
function targetOf(deployment, operationId) {
  const federation = (deployment.federations ?? []).find(
    (application) => application.operationId === operationId
  )

  if (federation) {
    return {
      name: federation.name,
      lead: federation.name,
      anchor: '#federated-credentials'
    }
  }

  return deployment.limitsOperation?.id === operationId
    ? {
        name: 'the limits change',
        lead: 'The limits change',
        anchor: '#health'
      }
    : null
}

// What a refused Retry or Reconcile says. The backend decided and gave a code;
// the words are the page's.
function refusalText(action, target, error) {
  if (action === 'retry' && error.code === NOT_RETRYABLE) {
    return `${target.lead} cannot be retried in its current state`
  }

  const reason =
    error.code === NOT_FOUND
      ? `: its change is no longer there`
      : ' in its current state'

  return `${ACTION_NAMES[action]} could not be done for ${target.name}${reason}. Check the table and try again`
}

function refusedView(h, { deployment, action, target, error }) {
  return deploymentView(h, deployment, {
    errorSummary: [
      { text: refusalText(action, target, error), href: target.anchor }
    ]
  }).code(error.statusCode)
}

function isRefusal(error) {
  return (
    error instanceof ApiError &&
    (error.statusCode === statusCodes.conflict || error.code === NOT_FOUND)
  )
}

function isBackendFailure(error) {
  return (
    error instanceof ApiError &&
    error.statusCode >= statusCodes.internalServerError
  )
}

// The operation's address takes only a POST, so the way on is the deployment
// page, where Retry and Reconcile are offered again.
function failedView(h, { teamId, environment }) {
  return h
    .view('error/index', {
      pageTitle: 'Service unavailable',
      heading: 'We could not do that',
      message:
        'The platform service did not answer. Try again in a few minutes.',
      actionHref: adminDeploymentUrl(teamId, environment),
      actionText: 'Back to the deployment'
    })
    .code(statusCodes.badGateway)
}

async function runAction(request, h, action) {
  const { teamId, environment, operationId } = request.params
  const deployment = await loadDeployment(request, teamId, environment)
  const target = targetOf(deployment, operationId)

  if (!target) {
    return deploymentNotFoundView(h)
  }

  try {
    await apiClient(request).post(
      `${OPERATIONS_API}/${encodeURIComponent(operationId)}/${action}`
    )
  } catch (error) {
    if (isRefusal(error)) {
      return refusedView(h, { deployment, action, target, error })
    }

    throw error
  }

  setAccountNotification(request, {
    type: 'success',
    message: `${ACTION_NAMES[action]} requested for ${target.name}. The table shows where it is.`
  })

  return h
    .redirect(adminDeploymentUrl(deployment.team.id, deployment.environment))
    .code(statusCodes.seeOther)
}

function actionController(action) {
  return {
    async handler(request, h) {
      try {
        return await runAction(request, h, action)
      } catch (error) {
        return isBackendFailure(error)
          ? failedView(h, request.params)
          : deploymentRefusalView(request, h, error)
      }
    }
  }
}

/**
 * The Platform Admin's Retry and Reconcile for a team's change by its
 * operation, from the deployment page. Each asks the backend for the
 * deployment first, which decides who may use it (plan D2).
 */
export const adminOperationController = {
  reconcile: actionController('reconcile'),
  retry: actionController('retry')
}

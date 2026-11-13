import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import {
  setAccountNotification,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import { teamStatusTag } from '#/server/common/helpers/team-status.js'
import { formatUkDateTime } from '#/server/common/helpers/uk-time.js'
import {
  ADMIN_AUDIT_URL,
  adminDeploymentUrl,
  adminTabs,
  adminTeamUrl
} from './admin-page.js'
import { isOffered, OFFERED } from './credential-actions.js'
import {
  credentialHeld,
  credentialStatus,
  credentialTag,
  modelStatusTag,
  statusTag
} from './deployment-labels.js'
import {
  DEPLOYMENTS_API,
  deploymentBreadcrumbs,
  deploymentNotFoundView,
  deploymentRefusalView,
  loadDeployment
} from './deployment-page.js'

const ACTION_NAMES = { reconcile: 'Reconcile', retry: 'Retry' }
const CHECKS_FAILED = 'checks-failed'
const HEALTH_ANCHOR = '#health'

const BUTTONS = {
  disable: { text: 'Disable credentials', classes: 'govuk-button--secondary' },
  enable: { text: 'Enable credentials', classes: '' },
  revoke: { text: 'Revoke credentials', classes: 'govuk-button--warning' }
}

function modelRows(deployment) {
  const base = adminDeploymentUrl(deployment.team.id, deployment.environment)

  return deployment.deployments.map((model) => ({
    id: model.id,
    name: model.modelName,
    status: modelStatusTag(model.status),
    detail: model.detail,
    at: model.updatedAt,
    updated: formatUkDateTime(model.updatedAt),
    reconcileUrl: `${base}/models/${encodeURIComponent(model.id)}/reconcile`,
    retryUrl: model.retryable
      ? `${base}/models/${encodeURIComponent(model.id)}/retry`
      : null,
    needsNewRequest: model.status === CHECKS_FAILED
  }))
}

function credentialButtons(deployment) {
  const base = adminDeploymentUrl(deployment.team.id, deployment.environment)

  return OFFERED.filter((action) =>
    isOffered(action, deployment.credential)
  ).map((action) => ({
    action,
    href: `${base}/credentials/${action}`,
    ...BUTTONS[action]
  }))
}

// What is under a block, as a tag, so the page still says Revoked when a
// disabled environment's credential has been revoked (P1-AC10). Nothing for a
// credential that is not blocked or a block the backend did not say it for.
function underBlock(credential) {
  const held = credentialHeld(credential)

  return credentialStatus(credential) === 'disabled' && held !== 'unknown'
    ? credentialTag(held)
    : null
}

function environmentLinks(deployment) {
  return deployment.environments.map(({ environment, credential }) => ({
    name: environmentName(environment),
    current: environment === deployment.environment,
    href: adminDeploymentUrl(deployment.team.id, environment),
    credential: credentialTag(credentialStatus(credential))
  }))
}

/**
 * The deployment page: the team in one environment, its credential and its
 * models' health, with what an admin can do. Used for the page itself and for
 * the page that says a Retry was refused.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {object} deployment - What the backend gave.
 * @param {object} [page]
 * @param {object | null} [page.notification]
 * @param {object[] | null} [page.errorSummary]
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function deploymentView(
  h,
  deployment,
  { notification = null, errorSummary = null } = {}
) {
  const { team, environment } = deployment
  const environmentLabel = environmentName(environment)

  return h.view('admin/deployment', {
    pageTitle: `${errorSummary ? 'Error: ' : ''}${team.name} in ${environmentLabel} - Admin`,
    heading: team.name,
    caption: environmentLabel,
    breadcrumbs: deploymentBreadcrumbs(deployment),
    tabs: adminTabs('deployments'),
    notification,
    errorSummary,
    environmentLabel,
    status: statusTag(deployment.status),
    credential: credentialTag(credentialStatus(deployment.credential)),
    blockedAt: deployment.credential?.blockedAt
      ? formatUkDateTime(deployment.credential.blockedAt)
      : null,
    underBlock: underBlock(deployment.credential),
    team: { ...team, statusTag: teamStatusTag(team.status) },
    memberText: `${team.memberCount} ${team.memberCount === 1 ? 'member' : 'members'}`,
    teamUrl: adminTeamUrl(team),
    activityUrl: `${ADMIN_AUDIT_URL}?team=${encodeURIComponent(team.id)}&environment=${encodeURIComponent(environment)}`,
    models: modelRows(deployment),
    buttons: credentialButtons(deployment),
    environments: environmentLinks(deployment)
  })
}

async function showDeployment(request, h) {
  const { teamId, environment } = request.params
  const deployment = await loadDeployment(request, teamId, environment)

  return deploymentView(h, deployment, {
    notification: takeAccountNotification(request)
  })
}

// What a refused Retry or Reconcile says. The backend decided and gave a code;
// the words are the page's.
function refusalText(action, model, error) {
  if (error.code === 'deployment-not-retryable') {
    return `${model.modelName} cannot be retried in its current state. A model whose checks failed needs a new request from the team`
  }

  return `${ACTION_NAMES[action]} could not be done for ${model.modelName} in its current state. Check the table and try again`
}

function refusedView(h, { deployment, action, model, error }) {
  return deploymentView(h, deployment, {
    errorSummary: [
      { text: refusalText(action, model, error), href: HEALTH_ANCHOR }
    ]
  }).code(statusCodes.conflict)
}

// Runs the built route for one of the page's models. The model must be one of
// the page's, so an address made up does not reach the backend; whether it may
// be run is the backend's decision.
async function runAction(request, h, action) {
  const { teamId, environment, entryId } = request.params
  const deployment = await loadDeployment(request, teamId, environment)
  const model = deployment.deployments.find(({ id }) => id === entryId)

  if (!model) {
    return deploymentNotFoundView(h)
  }

  try {
    await apiClient(request).post(
      `${DEPLOYMENTS_API}/${encodeURIComponent(entryId)}/${action}`
    )
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.statusCode === statusCodes.conflict
    ) {
      return refusedView(h, { deployment, action, model, error })
    }

    throw error
  }

  setAccountNotification(request, {
    type: 'success',
    message: `${ACTION_NAMES[action]} requested for ${model.modelName}. The table shows where it is.`
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
        return deploymentRefusalView(request, h, error)
      }
    }
  }
}

/**
 * The Platform Admin's page for one team's deployment in one environment, and
 * its Reconcile and Retry buttons. Each page asks the backend, which decides
 * who may see it and records a refusal (plan D2).
 */
export const adminDeploymentController = {
  get: {
    async handler(request, h) {
      try {
        return await showDeployment(request, h)
      } catch (error) {
        return deploymentRefusalView(request, h, error)
      }
    }
  },
  reconcile: actionController('reconcile'),
  retry: actionController('retry')
}

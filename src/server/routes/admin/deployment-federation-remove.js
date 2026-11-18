import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import { adminDeploymentUrl, isCallFailure } from './admin-page.js'
import {
  carryFormKey,
  federationRemoveKey,
  issueFormKey
} from './credential-keys.js'
import { readReason, REASON_CODES } from './credential-reason.js'
import { REMOVABLE_STATUSES } from './deployment-credential-rows.js'
import { guarded, pageView } from './deployment-credentials.js'
import { DEPLOYMENTS_API, loadDeployment } from './deployment-page.js'

// The pages that remove one of a team's federated applications: a reason,
// which is also the confirmation, then one call to the backend. Nothing here
// decides who may or whether the application can be removed: the page asks the
// backend for the deployment first, offers only an application it says is
// ready or failed, and the backend decides again on the call.

const REASON_ANCHOR = '#reason'
const REMOVE_APPLICATION = 'Remove application'
const NOT_AVAILABLE = 'That application is not available to remove.'

// What removing does and does not do (design F, "When it bites"): the gateway
// cannot tell which application a token came from, so a token already issued
// keeps working until it expires; Disable credentials is the immediate stop.
const REMOVE_EFFECT =
  'Removing cannot be undone. This application’s federated credential is removed, so it gets no new token. A token already issued to it keeps working until it expires, up to 2 hours. To stop calls now, also use Disable credentials on this deployment. The team’s other applications and its secrets are not changed. The team is not told why.'

function deploymentUrl(deployment) {
  return adminDeploymentUrl(deployment.team.id, deployment.environment)
}

function removeUrl(deployment, federationId) {
  return `${deploymentUrl(deployment)}/federations/${encodeURIComponent(federationId)}/remove`
}

// The application the page is for, when the deployment holds it and it can be
// removed: one being set up or removed, or one made up in the address, is not.
function removable(deployment, federationId) {
  return (deployment.federations ?? []).find(
    ({ id, status }) => id === federationId && REMOVABLE_STATUSES.has(status)
  )
}

function reasonView(h, deployment, application, form) {
  const heading = `Remove the application ${application.name}`
  const error = form.error ? { text: form.error } : null

  return pageView(h, 'admin/credential-reason', deployment, heading, {
    titleText: heading,
    crumb: REMOVE_APPLICATION,
    effect: REMOVE_EFFECT,
    buttonText: REMOVE_APPLICATION,
    buttonClasses: 'govuk-button--warning',
    backUrl: deploymentUrl(deployment),
    formKey: form.formKey,
    reasonText: form.text ?? '',
    errorSummary: error ? [{ text: error.text, href: REASON_ANCHOR }] : null,
    fieldError: error
  }).code(error ? statusCodes.badRequest : statusCodes.ok)
}

function failedView(h, deployment, application) {
  const heading = `We could not remove the application ${application.name}`

  return pageView(h, 'admin/credential-failed', deployment, heading, {
    titleText: heading,
    crumb: REMOVE_APPLICATION,
    doneText: null,
    retryUrl: removeUrl(deployment, application.id)
  }).code(statusCodes.badGateway)
}

function backToDeployment(request, h, deployment, notification) {
  setAccountNotification(request, notification)

  return h.redirect(deploymentUrl(deployment)).code(statusCodes.seeOther)
}

function notAvailable(request, h, deployment) {
  return backToDeployment(request, h, deployment, {
    type: 'info',
    message: NOT_AVAILABLE
  })
}

function inProgress(request, h, deployment, application) {
  return backToDeployment(request, h, deployment, {
    type: 'info',
    message: `${application.name} is being set up and cannot be removed yet. Try again when it is ready.`
  })
}

function removedNotification({ name }, result) {
  return result?.federation?.status === 'removed'
    ? { type: 'info', message: `${name} was already removed.` }
    : {
        type: 'success',
        message: `Removal requested for ${name}. The table shows where it is.`
      }
}

// What the backend refused that the admin can put right here is shown on the
// page, an application that went away or is not ready is a notice on the
// deployment, a call that failed is shown as one that can be tried again, and
// anything else is thrown.
function refusal(request, h, { deployment, application, form, error }) {
  if (error instanceof ApiError && REASON_CODES[error.code]) {
    return reasonView(h, deployment, application, {
      ...form,
      error: REASON_CODES[error.code]
    })
  }

  if (error instanceof ApiError && error.code === 'federation-not-found') {
    return notAvailable(request, h, deployment)
  }

  if (error instanceof ApiError && error.code === 'federation-in-progress') {
    return inProgress(request, h, deployment, application)
  }

  if (isCallFailure(error)) {
    return failedView(h, deployment, application)
  }

  throw error
}

// Removes the application, with the reason and a key of its own.
async function remove(request, h, { deployment, application, form }) {
  const { reason, formKey } = form
  const { id: teamId } = deployment.team
  const { environment } = deployment

  try {
    const result = await apiClient(request).post(
      `${DEPLOYMENTS_API}/${encodeURIComponent(teamId)}/${encodeURIComponent(environment)}/federations/${encodeURIComponent(application.id)}/remove`,
      { reason },
      {
        idempotencyKey: federationRemoveKey(request, {
          teamId,
          environment,
          federationId: application.id,
          formKey,
          reason
        })
      }
    )

    return backToDeployment(
      request,
      h,
      deployment,
      removedNotification(application, result)
    )
  } catch (error) {
    return refusal(request, h, { deployment, application, form, error })
  }
}

async function load(request) {
  const { teamId, environment, federationId } = request.params
  const deployment = await loadDeployment(request, teamId, environment)

  return { deployment, application: removable(deployment, federationId) }
}

const removeController = {
  async get(request, h) {
    const { deployment, application } = await load(request)

    return application
      ? reasonView(h, deployment, application, { formKey: issueFormKey() })
      : notAvailable(request, h, deployment)
  },
  async post(request, h) {
    const { deployment, application } = await load(request)

    if (!application) {
      return notAvailable(request, h, deployment)
    }

    const formKey = carryFormKey(request.payload?.formKey)
    const { reason, error, text } = readReason(request.payload?.reason)

    return error
      ? reasonView(h, deployment, application, { formKey, error, text })
      : remove(request, h, {
          deployment,
          application,
          form: { formKey, reason, text }
        })
  }
}

/**
 * The Platform Admin's pages that remove one federated application of a
 * team's deployment: the reason, then the remove. Each asks the backend for
 * the deployment first, which refuses anyone who is not a Platform Admin.
 */
export const adminFederationRemoveController = {
  get: { handler: guarded(removeController.get) },
  post: { handler: guarded(removeController.post) }
}

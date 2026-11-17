import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import { adminDeploymentUrl, isCallFailure } from './admin-page.js'
import {
  carryFormKey,
  issueFormKey,
  secretRevokeKey
} from './credential-keys.js'
import { readReason, REASON_CODES } from './credential-reason.js'
import { guarded, pageView } from './deployment-credentials.js'
import { DEPLOYMENTS_API, loadDeployment } from './deployment-page.js'

// The pages that revoke one of a team's client secrets: a reason, which is
// also the confirmation, then one call to the backend. Nothing here decides
// who may or whether the secret can be revoked: the page asks the backend for
// the deployment first, lists only a secret it says is active, and the backend
// decides again on the call.

const REASON_ANCHOR = '#reason'
const NO_LONGER_LISTED = 'That secret is not available to revoke.'

function deploymentUrl(deployment) {
  return adminDeploymentUrl(deployment.team.id, deployment.environment)
}

function revokeUrl(deployment, credentialId) {
  return `${deploymentUrl(deployment)}/credentials/${encodeURIComponent(credentialId)}/revoke`
}

// The secret the page is for, when the deployment holds it and it is still
// active: an expired or revoked one, or one made up in the address, is not
// revoked here.
function activeSecret(deployment, credentialId) {
  return (deployment.clientSecrets?.items ?? []).find(
    ({ id, status }) => id === credentialId && status === 'active'
  )
}

function endingText({ keyHint }) {
  return `ending ${keyHint}`
}

// What revoking does and does not do (design F, "When it bites"): the gateway
// cannot tell which secret a token came from, so a token already issued keeps
// working until it expires; Disable credentials is the immediate stop.
const REVOKE_EFFECT =
  'Revoking cannot be undone. No new token can be made with this secret. A token already issued with it keeps working until it expires, up to 2 hours. To stop calls now, also use Disable credentials on this deployment. The team’s other secrets are not changed. The team is not told why.'

function reasonView(h, deployment, secret, form) {
  const heading = `Revoke the secret ${endingText(secret)}`
  const error = form.error ? { text: form.error } : null

  return pageView(h, 'admin/credential-reason', deployment, heading, {
    titleText: heading,
    crumb: 'Revoke secret',
    effect: REVOKE_EFFECT,
    buttonText: 'Revoke secret',
    buttonClasses: 'govuk-button--warning',
    backUrl: deploymentUrl(deployment),
    formKey: form.formKey,
    reasonText: form.text ?? '',
    errorSummary: error ? [{ text: error.text, href: REASON_ANCHOR }] : null,
    fieldError: error
  }).code(error ? statusCodes.badRequest : statusCodes.ok)
}

function failedView(h, deployment, secret, credentialId) {
  const heading = `We could not revoke the secret ${endingText(secret)}`

  return pageView(h, 'admin/credential-failed', deployment, heading, {
    titleText: heading,
    crumb: 'Revoke secret',
    doneText: null,
    retryUrl: revokeUrl(deployment, credentialId)
  }).code(statusCodes.badGateway)
}

function backToDeployment(request, h, deployment, notification) {
  setAccountNotification(request, notification)

  return h.redirect(deploymentUrl(deployment)).code(statusCodes.seeOther)
}

function notAvailable(request, h, deployment) {
  return backToDeployment(request, h, deployment, {
    type: 'info',
    message: NO_LONGER_LISTED
  })
}

// Revokes the secret, with the reason and a key of its own. What the backend
// refused that the admin can put right here is shown on the page; a call that
// failed is shown as one that can be tried again; anything else is thrown.
async function revoke(request, h, { deployment, secret, credentialId, form }) {
  const { reason, formKey } = form
  const { id: teamId } = deployment.team
  const { environment } = deployment

  try {
    const result = await apiClient(request).post(
      `${DEPLOYMENTS_API}/${encodeURIComponent(teamId)}/${encodeURIComponent(environment)}/credentials/${encodeURIComponent(credentialId)}/revoke`,
      { reason },
      {
        idempotencyKey: secretRevokeKey(request, {
          teamId,
          environment,
          credentialId,
          formKey,
          reason
        })
      }
    )

    return backToDeployment(request, h, deployment, {
      type: result?.revoked === false ? 'info' : 'success',
      message:
        result?.revoked === false
          ? `The secret ${endingText(secret)} was already revoked.`
          : `Revoked the secret ${endingText(secret)}.`
    })
  } catch (error) {
    if (error instanceof ApiError && REASON_CODES[error.code]) {
      return reasonView(h, deployment, secret, {
        ...form,
        error: REASON_CODES[error.code]
      })
    }

    if (error instanceof ApiError && error.code === 'credential-not-found') {
      return notAvailable(request, h, deployment)
    }

    if (isCallFailure(error)) {
      return failedView(h, deployment, secret, credentialId)
    }

    throw error
  }
}

async function load(request) {
  const { teamId, environment, credentialId } = request.params
  const deployment = await loadDeployment(request, teamId, environment)

  return {
    deployment,
    credentialId,
    secret: activeSecret(deployment, credentialId)
  }
}

const revokeController = {
  async get(request, h) {
    const { deployment, secret } = await load(request)

    return secret
      ? reasonView(h, deployment, secret, { formKey: issueFormKey() })
      : notAvailable(request, h, deployment)
  },
  async post(request, h) {
    const { deployment, credentialId, secret } = await load(request)

    if (!secret) {
      return notAvailable(request, h, deployment)
    }

    const formKey = carryFormKey(request.payload?.formKey)
    const { reason, error, text } = readReason(request.payload?.reason)

    return error
      ? reasonView(h, deployment, secret, { formKey, error, text })
      : revoke(request, h, {
          deployment,
          secret,
          credentialId,
          form: { formKey, reason, text }
        })
  }
}

/**
 * The Platform Admin's pages that revoke one client secret of a team's
 * deployment: the reason, then the revoke. Each asks the backend for the
 * deployment first, which refuses anyone who is not a Platform Admin.
 */
export const adminSecretRevokeController = {
  get: { handler: guarded(revokeController.get) },
  post: { handler: guarded(revokeController.post) }
}

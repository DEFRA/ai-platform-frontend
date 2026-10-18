import { randomUUID } from 'node:crypto'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  setIssuedCredential,
  setAccountNotification
} from '#/server/common/helpers/session.js'

/**
 * GOV.UK copy for a stable backend code on the team connect journey.
 * @param {{code?: string, message: string}} error
 * @returns {string}
 */
export function errorMessageForCode(error) {
  if (error.code === 'deployment-exists') {
    return 'A deployment for this team and model already exists.'
  }

  if (error.code === 'model-not-eligible') {
    return 'This model is not available for your team.'
  }

  if (error.code === 'model-not-granted') {
    return 'Your team does not have access to this model.'
  }

  if (error.code === 'environment-not-available') {
    return 'This environment is not available yet.'
  }

  // In live mode no gateway issues team OAuth client secrets until the real
  // OAuth issuer exists (M7), so the backend refuses with 501.
  if (error.code === 'gateway-not-enabled') {
    return 'Team client secrets are not available in this environment yet.'
  }

  return error.message
}

// Explains a team credential that cannot be issued in this environment (see
// errorMessageForCode); any other error is unexpected here, so it rethrows.
function clientSecretUnavailableOrThrow(h, error) {
  if (!(error instanceof ApiError) || error.code !== 'gateway-not-enabled') {
    throw error
  }

  return h
    .view('error/index', {
      pageTitle: 'We cannot create your team client secret yet',
      heading: 'We cannot create your team client secret yet',
      message: errorMessageForCode(error),
      actionHref: '/manage',
      actionText: 'Go to your access'
    })
    .code(error.statusCode)
}

// The deployment is active and the signed-in member requested it: issue (or
// reuse) the team's shared credential and reveal its secret once.
export async function issueTeamClientSecret(
  request,
  h,
  { sessionUser, teamId, deployment }
) {
  // Defense in depth for /manage already hiding this deployment's request row
  // once its credential is revoked: a stale/bookmarked link could still reach
  // the request page directly, so re-check here too before issuing anything.
  // A revoked team credential is a deliberate, final action - it must not be
  // silently resurrected.
  const { items: existingCredentials } = await apiClient(request).get(
    '/v1/credentials',
    { userId: sessionUser.id }
  )
  const wasRevoked = existingCredentials.some(
    (existing) =>
      existing.teamId === teamId &&
      existing.tier === 'team' &&
      existing.status === 'revoked' &&
      (existing.allowedDeployments ?? []).includes(deployment.modelSlug)
  )

  if (wasRevoked) {
    setAccountNotification(request, {
      type: 'success',
      message:
        'Access to this model was revoked for your team. Ask your team to request access again from Connect if you still need it.'
    })

    return h.redirect('/manage').code(statusCodes.seeOther)
  }

  // Deployment fields (not session) are the source of truth here, so this
  // works even after the session's pendingAccess is gone - e.g. reached via a
  // "check progress" link from /manage. Team credentials are OAuth client
  // secrets, never subscription keys.
  let credential
  let secret
  try {
    ;({ credential, secret } = await apiClient(request).post(
      '/v1/credentials',
      {
        modelSlug: deployment.modelSlug,
        tier: 'team',
        teamId,
        environment: deployment.environment,
        credentialType: 'oauth'
      },
      { userId: sessionUser.id, idempotencyKey: randomUUID() }
    ))
  } catch (error) {
    return clientSecretUnavailableOrThrow(h, error)
  }

  if (!secret) {
    // Already issued and shown once to whoever triggered it originally -
    // nothing new to reveal. /manage always lists the team's credential
    // (key hint only).
    setAccountNotification(request, {
      type: 'success',
      message: "Your team's model is ready to use - see it below."
    })

    return h.redirect('/manage').code(statusCodes.seeOther)
  }

  const model = await apiClient(request).get(
    `/v1/models/${deployment.modelSlug}`
  )

  setIssuedCredential(request, { credential, secret, model })

  return h.redirect('/connect/team/credential').code(statusCodes.seeOther)
}

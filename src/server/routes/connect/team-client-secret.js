import { randomUUID } from 'node:crypto'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  clearRequestedDeployments,
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
    return 'Your team already has one of these models.'
  }

  if (error.code === 'model-not-eligible') {
    return 'One of these models is not available for your team.'
  }

  if (error.code === 'model-not-granted') {
    return 'Your team does not have access to one of these models.'
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

// Grants the team's shared OAuth client secret each model in turn: the
// first call may mint the secret, the rest add their model to it. A model
// that fails once the credential exists is reported rather than thrown, or
// the secret just minted would be lost before it was shown.
async function grantModels(request, sessionUser, teamId, deployments) {
  let credential
  let secret
  const notGranted = []

  for (const deployment of deployments) {
    try {
      const issued = await apiClient(request).post(
        '/v1/credentials',
        {
          modelSlug: deployment.modelSlug,
          tier: 'team',
          teamId,
          environment: deployment.environment,
          credentialType: 'oauth'
        },
        { userId: sessionUser.id, idempotencyKey: randomUUID() }
      )

      credential = issued.credential
      secret ??= issued.secret
    } catch (error) {
      if (!credential) {
        throw error
      }

      request.logger.warn(
        { err: error, modelSlug: deployment.modelSlug },
        'A model could not be added to the team client secret'
      )
      notGranted.push(deployment)
    }
  }

  return {
    credential,
    secret,
    granted: deployments.filter(
      (deployment) => !notGranted.includes(deployment)
    ),
    notGranted
  }
}

function fetchModels(request, deployments) {
  return Promise.all(
    deployments.map(({ modelSlug }) =>
      apiClient(request).get(`/v1/models/${modelSlug}`)
    )
  )
}

// The deployments are active and the signed-in member requested them: issue
// (or reuse) the team's shared credential, grant it each model, and reveal
// its secret once. `notReady` are the request's deployments that failed.
export async function issueTeamClientSecret(
  request,
  h,
  { sessionUser, teamId, deployments, notReady = [] }
) {
  // Defense in depth for /manage already hiding a deployment's request row
  // once its credential is revoked: a stale/bookmarked link could still reach
  // the request page directly, so re-check here too before issuing anything.
  // A revoked team credential is a deliberate, final action - it must not be
  // silently resurrected.
  const { items: existingCredentials } = await apiClient(request).get(
    '/v1/credentials',
    { userId: sessionUser.id }
  )
  const wasRevoked = ({ modelSlug }) =>
    existingCredentials.some(
      (existing) =>
        existing.teamId === teamId &&
        existing.tier === 'team' &&
        existing.status === 'revoked' &&
        (existing.allowedDeployments ?? []).includes(modelSlug)
    )
  const grantable = deployments.filter((deployment) => !wasRevoked(deployment))

  if (grantable.length === 0) {
    clearRequestedDeployments(request)
    setAccountNotification(request, {
      type: 'success',
      message: `Access to ${deployments.length > 1 ? 'these models was' : 'this model was'} revoked for your team. Ask your team to request access again from Connect if you still need it.`
    })

    return h.redirect('/manage').code(statusCodes.seeOther)
  }

  // Deployment fields (not session) are the source of truth here, so this
  // works even after the session's journey is gone - e.g. reached via a
  // "check progress" link from /manage. Team credentials are OAuth client
  // secrets, never subscription keys.
  let issued
  try {
    issued = await grantModels(request, sessionUser, teamId, grantable)
  } catch (error) {
    return clientSecretUnavailableOrThrow(h, error)
  }

  if (!issued.secret) {
    // Already issued and shown once to whoever triggered it originally -
    // nothing new to reveal. /manage always lists the team's credential
    // (key hint only).
    clearRequestedDeployments(request)
    setAccountNotification(request, {
      type: 'success',
      message: `Your team's ${issued.granted.length > 1 ? 'models are' : 'model is'} ready to use - see ${issued.granted.length > 1 ? 'them' : 'it'} below.`
    })

    return h.redirect('/manage').code(statusCodes.seeOther)
  }

  const [models, notAdded] = await Promise.all([
    fetchModels(request, issued.granted),
    fetchModels(request, [...issued.notGranted, ...notReady])
  ])

  setIssuedCredential(request, {
    credential: issued.credential,
    secret: issued.secret,
    models,
    notAdded: notAdded.map(({ displayName }) => displayName)
  })
  clearRequestedDeployments(request)

  return h.redirect('/connect/team/credential').code(statusCodes.seeOther)
}

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getRequestedDeployments,
  getSessionUser,
  setAccountNotification,
  takeIssuedCredential
} from '#/server/common/helpers/session.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import {
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS
} from '#/server/common/helpers/deployment-status.js'
import { credentialEnvironmentName } from '#/server/common/helpers/environment-names.js'
import { isPlaceholderCredential } from '#/server/common/helpers/placeholder-credential.js'
import { issueTeamClientSecret } from './team-client-secret.js'
import {
  FAILURE_STATUSES,
  IN_PROGRESS_STATUSES,
  QUEUED_STATUS,
  buildPipelineLinks,
  waitPageHeading
} from './team-request-view.js'

function redirectToStart(h) {
  return h.redirect('/models').takeover()
}

function notFoundView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Request not found',
      heading: 'Request not found',
      message:
        'This request does not exist, or you are not a member of this team.',
      actionHref: '/manage',
      actionText: 'Go to your access'
    })
    .code(statusCodes.notFound)
}

// The page follows every deployment its request made, which the session
// remembers; without that it follows just the one in its address.
function requestedIds(request, teamId, id) {
  const requested = getRequestedDeployments(request)

  return requested?.teamId === teamId && requested.ids.includes(id)
    ? requested.ids
    : [id]
}

// The request's deployments in the order asked, or null when the team or
// the deployment in the address is not the person's to see.
async function findRequested(request, sessionUser, teamId, id) {
  let items

  try {
    ;({ items } = await apiClient(request).get(
      `/v1/teams/${teamId}/deployments`,
      { userId: sessionUser.id }
    ))
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.statusCode === statusCodes.notFound
    ) {
      return null
    }

    throw error
  }

  const found = requestedIds(request, teamId, id)
    .map((wanted) => items.find(({ _id }) => _id === wanted))
    .filter(Boolean)

  return found.some(({ _id }) => _id === id) ? found : null
}

// Model names only matter when several models are listed together.
async function modelNamesBySlug(request, deployments) {
  if (deployments.length < 2) {
    return {}
  }

  const { items } = await apiClient(request).get('/v1/models?tier=team')

  return Object.fromEntries(
    items.map(({ slug, displayName }) => [slug, displayName])
  )
}

function requestItem(deployment, title) {
  return {
    title,
    queued: deployment.status === QUEUED_STATUS,
    stages: deployment.progressSteps ?? [],
    pipelineLinks: buildPipelineLinks(deployment.links),
    failureReason: deployment.failureReason ?? null,
    verificationFailed: Boolean(deployment.verificationFailure)
  }
}

function waitView(h, waiting, requests) {
  const queued = waiting.every(({ status }) => status === QUEUED_STATUS)
  const heading = waitPageHeading(waiting.map(({ status }) => status))

  return h.view('connect/team/request', {
    pageTitle: heading,
    heading,
    queued,
    placeholderCredential: waiting.some(
      ({ credentialPlaceholder }) => credentialPlaceholder
    ),
    refreshSeconds: 3,
    lastCheckedAt: formatDate(new Date(), 'HH:mm'),
    failed: false,
    requests
  })
}

/**
 * The wait page for a team request, and where it ends: the client secret
 * once every model that could be set up is, or why none could.
 */
export const teamRequestController = {
  request: {
    get: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)

        if (!sessionUser) {
          return redirectToStart(h)
        }

        const { teamId, id } = request.params
        const deployments = await findRequested(
          request,
          sessionUser,
          teamId,
          id
        )

        if (!deployments) {
          return notFoundView(h)
        }

        // A model being removed, or already gone, is the team page's to show.
        const live = deployments.filter(
          ({ status }) =>
            status !== DEPLOYMENT_REMOVING_STATUS &&
            status !== DEPLOYMENT_REMOVED_STATUS
        )

        if (live.length === 0) {
          return h.redirect(`/teams/${teamId}`).code(statusCodes.seeOther)
        }

        const names = await modelNamesBySlug(request, live)
        const requests = live.map((deployment) =>
          requestItem(
            deployment,
            live.length > 1
              ? (names[deployment.modelSlug] ?? deployment.modelSlug)
              : null
          )
        )
        const waiting = live.filter(({ status }) =>
          IN_PROGRESS_STATUSES.includes(status)
        )

        if (waiting.length > 0) {
          return waitView(h, waiting, requests)
        }

        const failed = live.filter(({ status }) =>
          FAILURE_STATUSES.includes(status)
        )
        const ready = live.filter(
          ({ status }) => !FAILURE_STATUSES.includes(status)
        )

        if (ready.length === 0) {
          return h.view('connect/team/request', {
            pageTitle: "We could not set up your team's access",
            heading: "We could not set up your team's access",
            refreshSeconds: null,
            failed: true,
            verificationFailed: requests.some(
              ({ verificationFailed }) => verificationFailed
            ),
            requests
          })
        }

        // Only the member who requested the deployments may trigger issuance
        // and see the one-time secret. Everyone else gets the read-only
        // /manage view.
        if (ready[0].requestedBy !== sessionUser.id) {
          setAccountNotification(request, {
            type: 'success',
            message:
              "Your team's models are ready to use - see them below. Ask the person who requested them for the connection details."
          })

          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        return issueTeamClientSecret(request, h, {
          sessionUser,
          teamId,
          deployments: ready,
          notReady: failed
        })
      }
    }
  },

  credential: {
    get: {
      handler(request, h) {
        const issued = takeIssuedCredential(request)

        if (!issued) {
          return h.redirect('/models')
        }

        return h
          .view('connect/shared/credential', {
            pageTitle: 'Your connection details',
            heading: 'Your connection details',
            ...issued,
            placeholderCredential: isPlaceholderCredential(issued.credential),
            model: issued.models[0],
            modelNames: issued.models.map(({ displayName }) => displayName),
            modelRows: issued.models.map((model) => [
              { text: model.displayName },
              { text: model.deploymentName },
              { text: model.apiVersion },
              {
                text: `${model.limitsDefault.requestsPerMinute} requests a minute`
              }
            ]),
            environmentName: credentialEnvironmentName(issued.credential)
          })
          .header('cache-control', 'no-store')
      }
    }
  }
}

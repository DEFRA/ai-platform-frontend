import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getSessionUser,
  getPendingAccess,
  setPendingAccess,
  setIssuedCredential,
  takeIssuedCredential,
  setAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { config } from '#/config/config.js'
import {
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS
} from '#/server/common/helpers/deployment-status.js'

// The environments this instance deploys a team's models to (D1): the CDP
// dev instance drives Infradev, the test instance the Sandbox. Shown as
// radios from the configured list, the first preselected; the backend
// refuses anything outside its own list as `environment-not-available`.
const ENVIRONMENT_NAMES = {
  infradev: 'Infradev',
  sandbox: 'Sandbox',
  dev: 'Development',
  qa: 'QA',
  test: 'Test',
  preprod: 'Pre-production',
  prod: 'Production',
  uat: 'UAT'
}

/**
 * The environments a team may choose from, as GOV.UK radio items.
 * @returns {Array<{value: string, text: string, checked: boolean}>}
 */
function environmentItems() {
  return config.get('teamEnvironments').map((value, index) => ({
    value,
    text: ENVIRONMENT_NAMES[value] ?? value,
    checked: index === 0
  }))
}

function environmentHint() {
  const names = environmentItems().map((item) => item.text)

  return names.length === 1
    ? `Only ${names[0]} is available today.`
    : `Available today: ${names.join(', ')}.`
}

// The wait page groups every intermediate GitOps state into one friendly
// "being set up" message - it never shows raw GitOps jargon to the user (B09).
// GitOps applies one change per team file at a time, so a request made while
// another is in flight waits as `queued`, which gets its own wording.
const QUEUED_STATUS = 'queued'
const IN_PROGRESS_STATUSES = [
  QUEUED_STATUS,
  'requested',
  'pr-raised',
  'merged',
  'deploying',
  'deployed',
  'verified'
]
const FAILURE_STATUSES = ['checks-failed', 'deploy-failed']

function waitPageHeading(status) {
  return status === QUEUED_STATUS
    ? 'Waiting for another change to this team to finish'
    : 'Setting up your team client secret'
}

// Support links to the GitOps runs and pull request behind a team request,
// when the backend has them. Labelled here, and only https links are shown.
const PIPELINE_LINK_LABELS = {
  submitRun: 'Submit workflow run',
  pullRequest: 'Pull request',
  applyRun: 'Apply workflow run'
}

function buildPipelineLinks(links = {}) {
  return Object.entries(PIPELINE_LINK_LABELS)
    .filter(
      ([key]) =>
        typeof links[key] === 'string' && links[key].startsWith('https://')
    )
    .map(([key, text]) => ({ href: links[key], text }))
}

// The team journey needs both a chosen team and a chosen model. Without the
// teamId a shared-flow session would fall through to /v1/teams/undefined/....
function hasTeamJourneyState(pendingAccess) {
  return Boolean(
    pendingAccess?.modelSlug &&
    pendingAccess?.teamId &&
    pendingAccess?.accessType === 'team'
  )
}

const selectTeamSchema = Joi.object({
  teamId: Joi.string().required().messages({
    'any.required': 'Select a team'
  })
})

const selectModelSchema = Joi.object({
  modelSlug: Joi.string().required().messages({
    'any.required': 'Select a model'
  })
})

const detailsSchema = Joi.object({
  purpose: Joi.string().trim().max(500).allow('').optional().messages({
    'string.max': 'Purpose must be 500 characters or fewer'
  }),
  environment: Joi.string()
    .valid(...config.get('teamEnvironments'))
    .default(config.get('teamEnvironments')[0])
    .messages({ 'any.only': 'Select an available environment' })
})

function redirectToStart(h) {
  return h.redirect('/connect').takeover()
}

function buildTeamItems(teamsList, selectedTeamId) {
  return teamsList.map((team) => ({
    value: team._id,
    text: team.name,
    checked: team._id === selectedTeamId
  }))
}

function buildModelItems(models, selectedModelSlug) {
  return models.map((model) => ({
    value: model.slug,
    text: model.displayName,
    hint: { text: model.description },
    checked: model.slug === selectedModelSlug
  }))
}

function errorMessageForCode(error) {
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
async function issueTeamClientSecret(
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

export const teamConnectController = {
  selectTeam: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (pendingAccess?.accessType !== 'team') {
          return redirectToStart(h)
        }

        const sessionUser = getSessionUser(request)
        const { items } = await apiClient(request).get('/v1/teams', {
          userId: sessionUser.id
        })

        if (items.length === 0) {
          return h
            .redirect('/teams/new?returnTo=%2Fconnect%2Fteam%2Fselect')
            .code(statusCodes.seeOther)
        }

        return h.view('connect/team/select', {
          pageTitle: 'Choose a team',
          heading: 'Which team is this for?',
          teamItems: buildTeamItems(items, pendingAccess.teamId),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: selectTeamSchema,
          failAction: async (request, h, error) => {
            const sessionUser = getSessionUser(request)
            const { items } = await apiClient(request).get('/v1/teams', {
              userId: sessionUser.id
            })

            return h
              .view('connect/team/select', {
                pageTitle: 'Error: Choose a team',
                heading: 'Which team is this for?',
                teamItems: buildTeamItems(items, request.payload.teamId),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (pendingAccess?.accessType !== 'team') {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          teamId: request.payload.teamId
        })

        return h.redirect('/connect/team/model').code(statusCodes.seeOther)
      }
    }
  },

  selectModel: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.teamId) {
          return redirectToStart(h)
        }

        const { items } = await apiClient(request).get('/v1/models?tier=team')

        return h.view('connect/shared/model', {
          pageTitle: 'Choose a model',
          heading: 'Which model do you want to connect to?',
          modelItems: buildModelItems(items, pendingAccess.modelSlug),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: selectModelSchema,
          failAction: async (request, h, error) => {
            const { items } = await apiClient(request).get(
              '/v1/models?tier=team'
            )

            return h
              .view('connect/shared/model', {
                pageTitle: 'Error: Choose a model',
                heading: 'Which model do you want to connect to?',
                modelItems: buildModelItems(items, request.payload.modelSlug),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!pendingAccess?.teamId) {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          modelSlug: request.payload.modelSlug
        })

        return h.redirect('/connect/team/details').code(statusCodes.seeOther)
      }
    }
  },

  details: {
    get: {
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        return h.view('connect/team/details', {
          pageTitle: 'Say what it is for',
          heading: 'Say what it is for',
          values: { purpose: pendingAccess.purpose ?? '' },
          environmentItems: environmentItems(),
          environmentHint: environmentHint(),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },
    post: {
      options: {
        validate: {
          payload: detailsSchema,
          failAction: (request, h, error) =>
            h
              .view('connect/team/details', {
                pageTitle: 'Error: Say what it is for',
                heading: 'Say what it is for',
                values: request.payload,
                environmentItems: environmentItems(),
                environmentHint: environmentHint(),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
        }
      },
      handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        setPendingAccess(request, {
          ...pendingAccess,
          purpose: request.payload.purpose ?? '',
          environment: request.payload.environment
        })

        return h.redirect('/connect/team/check').code(statusCodes.seeOther)
      }
    }
  },

  check: {
    get: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        const model = await apiClient(request).get(
          `/v1/models/${pendingAccess.modelSlug}`
        )

        return h.view('connect/team/check', {
          pageTitle: 'Check your answers',
          heading: 'Check your answers',
          model,
          purpose: pendingAccess.purpose,
          environment: pendingAccess.environment,
          errorMessage: null,
          existingRequestUrl: null
        })
      }
    },
    post: {
      async handler(request, h) {
        const pendingAccess = getPendingAccess(request)
        const sessionUser = getSessionUser(request)

        if (!hasTeamJourneyState(pendingAccess)) {
          return redirectToStart(h)
        }

        // Session can legitimately expire mid-journey, same as Route 1's
        // shared flow: send the person back to the start.
        if (!sessionUser) {
          return redirectToStart(h)
        }

        try {
          const { deployment } = await apiClient(request).post(
            `/v1/teams/${pendingAccess.teamId}/deployments`,
            {
              modelSlug: pendingAccess.modelSlug,
              environment: pendingAccess.environment
            },
            { userId: sessionUser.id, idempotencyKey: randomUUID() }
          )

          return h
            .redirect(
              `/connect/team/request/${pendingAccess.teamId}/${deployment._id}`
            )
            .code(statusCodes.seeOther)
        } catch (error) {
          if (error instanceof ApiError) {
            const model = await apiClient(request).get(
              `/v1/models/${pendingAccess.modelSlug}`
            )

            const existingRequestUrl =
              error.code === 'deployment-exists' && error.existingId
                ? `/connect/team/request/${pendingAccess.teamId}/${error.existingId}`
                : null

            return h
              .view('connect/team/check', {
                pageTitle: 'Check your answers',
                heading: 'Check your answers',
                model,
                purpose: pendingAccess.purpose,
                environment: pendingAccess.environment,
                errorMessage: errorMessageForCode(error),
                existingRequestUrl
              })
              .code(error.statusCode)
          }

          throw error
        }
      }
    }
  },

  request: {
    get: {
      async handler(request, h) {
        const sessionUser = getSessionUser(request)

        if (!sessionUser) {
          return redirectToStart(h)
        }

        const { teamId, id } = request.params

        let deployment
        try {
          ;({ deployment } = await apiClient(request).get(
            `/v1/teams/${teamId}/deployments/${id}`,
            { userId: sessionUser.id }
          ))
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.statusCode === statusCodes.notFound
          ) {
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

          throw error
        }

        if (
          deployment.status === DEPLOYMENT_REMOVING_STATUS ||
          deployment.status === DEPLOYMENT_REMOVED_STATUS
        ) {
          return h.redirect(`/teams/${teamId}`).code(statusCodes.seeOther)
        }

        if (IN_PROGRESS_STATUSES.includes(deployment.status)) {
          const heading = waitPageHeading(deployment.status)

          return h.view('connect/team/request', {
            pageTitle: heading,
            heading,
            queued: deployment.status === QUEUED_STATUS,
            refreshSeconds: 3,
            lastCheckedAt: formatDate(new Date(), 'HH:mm'),
            failed: false,
            stages: deployment.progressSteps,
            pipelineLinks: buildPipelineLinks(deployment.links)
          })
        }

        if (FAILURE_STATUSES.includes(deployment.status)) {
          return h.view('connect/team/request', {
            pageTitle: "We could not set up your team's access",
            heading: "We could not set up your team's access",
            refreshSeconds: null,
            failed: true,
            stages: [],
            failureReason: deployment.failureReason ?? null,
            pipelineLinks: buildPipelineLinks(deployment.links)
          })
        }

        // Only the member who requested the deployment may trigger issuance and
        // see the one-time secret. Everyone else gets the read-only /manage view.
        if (deployment.requestedBy !== sessionUser.id) {
          setAccountNotification(request, {
            type: 'success',
            message:
              "Your team's model is ready to use - see it below. Ask the person who requested it for the connection details."
          })

          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        return issueTeamClientSecret(request, h, {
          sessionUser,
          teamId,
          deployment
        })
      }
    }
  },

  credential: {
    get: {
      handler(request, h) {
        const issued = takeIssuedCredential(request)

        if (!issued) {
          return h.redirect('/connect')
        }

        return h
          .view('connect/shared/credential', {
            pageTitle: 'Your connection details',
            heading: 'Your connection details',
            ...issued
          })
          .header('cache-control', 'no-store')
      }
    }
  }
}

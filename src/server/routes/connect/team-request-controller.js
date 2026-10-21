import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  getRequestedDeployments,
  getSessionUser
} from '#/server/common/helpers/session.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import {
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS
} from '#/server/common/helpers/deployment-status.js'
import {
  environmentName,
  environmentSetUpUrl,
  teamEnvironmentList
} from '#/server/common/helpers/environment-names.js'
import {
  TEAM_AVAILABILITY,
  teamAvailability
} from '#/server/routes/models/model-availability.js'
import {
  TEAM_SECRET_STATE,
  teamSecretFor
} from '#/server/routes/teams/team-secret.js'
import { loadTeamForView, teamUrl } from '#/server/routes/teams/team-view.js'
import { joinNames } from './team-model-choices.js'
import {
  FAILURE_STATUSES,
  QUEUED_STATUS,
  buildPipelineLinks,
  buildStepItems,
  supportReference
} from './team-request-view.js'

const ACTIVE_STATUS = 'active'
const TEST_ENVIRONMENT = 'qa'
const REFRESH_SECONDS = 3

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
function requestedIds(request, team, id) {
  const requested = getRequestedDeployments(request)

  return requested?.teamSlug === team && requested.ids.includes(id)
    ? requested.ids
    : [id]
}

// The team and its deployments, or null when the team is not the person's to
// see (a team they do not belong to is the same answer as one that does not
// exist).
async function loadTeamAndDeployments(request, team) {
  try {
    const result = await loadTeamForView(request, team)
    const { items } = await apiClient(request).get(
      `/v1/teams/${encodeURIComponent(team)}/deployments`,
      { userId: getSessionUser(request).id }
    )

    return { ...result, deployments: items }
  } catch (error) {
    if (
      error instanceof ApiError &&
      [statusCodes.forbidden, statusCodes.notFound].includes(error.statusCode)
    ) {
      return null
    }

    throw error
  }
}

// The catalogue by slug: names for the headings, and what a failed model was
// offered as.
async function loadCatalogue(request) {
  const { items } = await apiClient(request).get(
    '/v1/models?includeIneligible=true'
  )

  return Object.fromEntries(items.map((model) => [model.slug, model]))
}

function modelName(catalogue, deployment) {
  return catalogue[deployment.modelSlug]?.displayName ?? deployment.modelSlug
}

function waitView(h, { team, live, catalogue }) {
  const queued = live.every(({ status }) => status === QUEUED_STATUS)
  const names = live.map((deployment) => modelName(catalogue, deployment))
  const heading = queued
    ? `Waiting for another change to ${team.name} to finish`
    : `Setting up ${joinNames(names)} for your team`
  const duration = `This usually takes about 2 minutes${live.length > 1 ? ' for each model' : ''}.`

  return h.view('connect/team/request', {
    pageTitle: heading,
    heading,
    teamName: team.name,
    teamUrl: teamUrl(team),
    lead: queued
      ? 'Your request starts when the one before it finishes. You can leave this page and come back.'
      : `${duration} You can leave this page and come back.`,
    refreshSeconds: REFRESH_SECONDS,
    lastCheckedAt: formatDate(new Date(), 'HH:mm'),
    requests: live.map((deployment, index) => ({
      title: live.length > 1 ? names[index] : null,
      steps: buildStepItems(deployment.progressSteps)
    }))
  })
}

// The team's client secret for the environment the models were set up in: the
// backend grants the models to it when they turn active, so it exists by now.
// It can be shown once it is in the vault.
async function findTeamCredential(request, deployment, deployments) {
  const { items } = await apiClient(request).get('/v1/credentials', {
    userId: getSessionUser(request).id
  })
  const { state, credential } = teamSecretFor(items, deployments, {
    teamId: deployment.teamId,
    environment: deployment.environment
  })

  return {
    id: state === TEAM_SECRET_STATE.ready ? credential._id : null,
    revoked: state === TEAM_SECRET_STATE.revoked
  }
}

// "set it up in Test": only once Test can be set up, and not from Test itself.
function testSetUp(team, environment) {
  const test = teamEnvironmentList().find(
    (item) => item.environment === TEST_ENVIRONMENT
  )

  return test?.available && environment !== TEST_ENVIRONMENT
    ? { name: test.name, url: environmentSetUpUrl(team.slug, test.environment) }
    : null
}

async function readyView(
  request,
  h,
  { team, isAdmin, ready, allDeployments, catalogue }
) {
  const names = ready.map((deployment) => modelName(catalogue, deployment))
  const { environment } = ready[0]
  const credential = isAdmin
    ? await findTeamCredential(request, ready[0], allDeployments)
    : { id: null, revoked: false }
  const heading = `${joinNames(names)} ${names.length > 1 ? 'are' : 'is'} ready`

  return h.view('connect/team/ready', {
    pageTitle: heading,
    heading,
    teamName: team.name,
    teamUrl: teamUrl(team),
    environmentName: environmentName(environment),
    modelNames: joinNames(names),
    isAdmin,
    revealUrl: credential.id
      ? `${teamUrl(team)}/client-secrets/${encodeURIComponent(credential.id)}/view`
      : null,
    secretRevoked: credential.revoked,
    testSetUp: testSetUp(team, environment)
  })
}

// Why a model could not be set up, in plain words. The one reason people can
// act on is a model that should not have been offered; anything else is the
// platform team's to look at, in the technical details.
function failureSentence(model, deployment, team) {
  const name = model?.displayName ?? deployment.modelSlug

  if (deployment.verificationFailure) {
    return `${name} was created for ${team.name}, but we could not confirm it is working.`
  }

  if (model && teamAvailability(model) !== TEAM_AVAILABILITY.inUk) {
    return `${name} is not available to teams in the UK yet, so it could not be set up. It should not have been offered to you.`
  }

  return `${name} could not be set up for ${team.name}.`
}

// The models the team has that this failure did not touch: those of the
// request that are ready, and any it had already.
function unaffectedNames(allDeployments, failed, catalogue) {
  const failedSlugs = new Set(failed.map(({ modelSlug }) => modelSlug))
  const environments = new Set(failed.map(({ environment }) => environment))
  const slugs = [
    ...new Set(
      allDeployments
        .filter(
          ({ status, modelSlug, environment }) =>
            status === ACTIVE_STATUS &&
            environments.has(environment) &&
            !failedSlugs.has(modelSlug)
        )
        .map(({ modelSlug }) => modelSlug)
    )
  ]

  return slugs.map((slug) => catalogue[slug]?.displayName ?? slug)
}

function failedView(h, { team, isAdmin, failed, allDeployments, catalogue }) {
  const names = failed.map((deployment) => modelName(catalogue, deployment))
  const others = unaffectedNames(allDeployments, failed, catalogue)
  const heading = `We could not set up ${joinNames(names)}`
  const reasons = failed.map((deployment) =>
    failureSentence(catalogue[deployment.modelSlug], deployment, team)
  )
  const notAffected = others.length
    ? ` ${joinNames(others)} ${others.length > 1 ? 'are' : 'is'} not affected.`
    : ''
  const references = failed.map(({ operationId }) =>
    supportReference(operationId)
  )

  return h.view('connect/team/failed', {
    pageTitle: heading,
    heading,
    teamName: team.name,
    reason: `${reasons.join(' ')}${notAffected}`,
    isAdmin,
    removals: failed.map((deployment, index) => ({
      text: failed.length > 1 ? `remove ${names[index]}` : 'remove it',
      href: `${teamUrl(team)}/models/${encodeURIComponent(deployment._id)}/remove`
    })),
    others: others.length ? joinNames(others) : null,
    references: references.filter(Boolean).join(', '),
    technical: failed.map((deployment, index) => ({
      title: failed.length > 1 ? names[index] : null,
      reference: references[index],
      failureReason: deployment.failureReason ?? null,
      links: buildPipelineLinks(deployment.links)
    }))
  })
}

/**
 * The page that follows a team request to its end: the wait while the models
 * are set up, then the ready page (where an admin can show the client secret
 * and a member is told to ask one) or why a model could not be set up. The
 * backend gives the team its client secret when a model turns active, so
 * nobody receives one from here.
 */
export const teamRequestController = {
  request: {
    get: {
      async handler(request, h) {
        if (!getSessionUser(request)) {
          return redirectToStart(h)
        }

        const { team: teamParam, id } = request.params
        const loaded = await loadTeamAndDeployments(request, teamParam)

        if (!loaded) {
          return notFoundView(h)
        }

        const { team, isAdmin, deployments } = loaded
        // The session remembers the team by its slug, which the address may
        // not use (progress links elsewhere carry the team's id).
        const asked = requestedIds(request, team.slug, id)
          .map((wanted) => deployments.find(({ _id }) => _id === wanted))
          .filter(Boolean)

        if (!asked.some(({ _id }) => _id === id)) {
          return notFoundView(h)
        }

        // A model being removed, or already gone, is the team page's to show.
        const live = asked.filter(
          ({ status }) =>
            status !== DEPLOYMENT_REMOVING_STATUS &&
            status !== DEPLOYMENT_REMOVED_STATUS
        )

        if (live.length === 0) {
          return h.redirect(teamUrl(team)).code(statusCodes.seeOther)
        }

        const catalogue = await loadCatalogue(request)
        const failed = live.filter(({ status }) =>
          FAILURE_STATUSES.includes(status)
        )
        const ready = live.filter(({ status }) => status === ACTIVE_STATUS)

        // Anything still on its way (and any state this page does not know)
        // keeps the page waiting, and refreshing.
        if (failed.length + ready.length < live.length) {
          return waitView(h, { team, live, catalogue })
        }

        if (failed.length > 0) {
          return failedView(h, {
            team,
            isAdmin,
            failed,
            allDeployments: deployments,
            catalogue
          })
        }

        return readyView(request, h, {
          team,
          isAdmin,
          ready,
          allDeployments: deployments,
          catalogue
        })
      }
    }
  }
}

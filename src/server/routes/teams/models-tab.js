import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { apiClient } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import {
  DEPLOYMENT_FAILURE_STATUSES,
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS,
  deploymentStatusText,
  deploymentTagClass,
  isDeploymentInProgress
} from '#/server/common/helpers/deployment-status.js'
import {
  defaultTeamEnvironment,
  environmentSetUpUrl,
  teamEnvironmentList
} from '#/server/common/helpers/environment-names.js'
import { joinNames } from '#/server/routes/connect/team-model-choices.js'
import { TEAM_SECRET_STATE, teamSecretFor } from './team-secret.js'
import { teamUrl } from './team-view.js'

const ACTIVE_STATUS = 'active'
const ADD_MODEL_URL = '/connect/team/start'

// How often the Models tab re-reads while any model is changing.
export const MODELS_CHANGING_REFRESH_SECONDS = 5

const numberFormat = new Intl.NumberFormat('en-GB')

// A read's outcome, however it went, so one that fails does not stop another.
function settled(read) {
  return Promise.allSettled([read]).then(([outcome]) => outcome)
}

/**
 * Where a model's set-up is followed: its progress, or what went wrong.
 * @param {{slug: string}} team
 * @param {{_id: string}} deployment
 * @returns {string}
 */
export function requestUrl(team, deployment) {
  return `/connect/team/request/${encodeURIComponent(team.slug)}/${encodeURIComponent(deployment._id)}`
}

// One model in an environment: its state, what a person can do about it, and
// (for an admin) the way to remove it, which a ready or failed model has.
function modelRow(deployment, { team, isAdmin, modelNames }) {
  const { status } = deployment
  const failed = DEPLOYMENT_FAILURE_STATUSES.includes(status)
  const inProgress = isDeploymentInProgress(status)
  let detail = null

  if (failed) {
    detail = { text: 'See what happened', href: requestUrl(team, deployment) }
  } else if (inProgress && status !== DEPLOYMENT_REMOVING_STATUS) {
    detail = { text: 'See progress', href: requestUrl(team, deployment) }
  }

  return {
    name: modelNames[deployment.modelSlug] ?? deployment.modelSlug,
    statusText: deploymentStatusText(status),
    tagClass: deploymentTagClass(status),
    inProgress,
    // A removal that failed returns the model as ready, with the reason.
    reason:
      status === ACTIVE_STATUS ? (deployment.failureReason ?? null) : null,
    detail,
    removeUrl:
      isAdmin && (status === ACTIVE_STATUS || failed)
        ? `${teamUrl(team)}/models/${encodeURIComponent(deployment._id)}/remove`
        : null
  }
}

// The team's client secret for an environment: when it expires (only when the
// credential says so, D11), and what a person can do with it. Admins view,
// rotate and revoke it; members are told to ask an admin.
function secretRow({ team, environment, isAdmin, credentials, deployments }) {
  if (credentials === null) {
    return { text: 'We could not check this just now.' }
  }

  const { state, credential } = teamSecretFor(credentials, deployments, {
    teamId: team._id,
    environment
  })

  if (state === TEAM_SECRET_STATE.revoked) {
    return { text: 'Revoked' }
  }

  if (state === TEAM_SECRET_STATE.preparing) {
    return { text: 'Being prepared. Check again in a moment.' }
  }

  if (state === TEAM_SECRET_STATE.none) {
    return { text: 'Ready once a model has been set up.' }
  }

  const base = `${teamUrl(team)}/client-secrets/${encodeURIComponent(credential._id)}`

  return {
    text: credential.expiresAt
      ? `Expires ${formatDate(credential.expiresAt)}`
      : '',
    actions: isAdmin
      ? [
          { text: 'View', href: `${base}/view` },
          { text: 'Rotate', href: `${base}/rotate` },
          { text: 'Revoke', href: `${base}/revoke` }
        ]
      : [],
    askAnAdmin: !isAdmin
  }
}

function limitsText(environments, environment) {
  const limits = environments?.find(
    (candidate) => candidate.environment === environment
  )?.limits

  if (
    typeof limits?.requestsPerMinute !== 'number' ||
    typeof limits?.tokensPerMinute !== 'number'
  ) {
    return null
  }

  return `${numberFormat.format(limits.requestsPerMinute)} requests and ${numberFormat.format(limits.tokensPerMinute)} tokens a minute`
}

// Where "Add a model" goes: the request journey sets models up in the first
// available environment, so another environment adds them from its own page.
function addModelUrl(team, environment) {
  return environment === defaultTeamEnvironment()
    ? ADD_MODEL_URL
    : environmentSetUpUrl(team.slug, environment)
}

function environmentCard(item, context) {
  const { team, deployments } = context
  const inEnvironment = deployments.filter(
    ({ environment }) => environment === item.environment
  )
  const live = inEnvironment.filter(
    ({ status }) => status !== DEPLOYMENT_REMOVED_STATUS
  )
  const card = { name: item.name }

  if (live.length > 0) {
    return {
      ...card,
      addModelUrl: addModelUrl(team, item.environment),
      models: live.map((deployment) => modelRow(deployment, context)),
      secret: secretRow({ ...context, environment: item.environment }),
      limits: limitsText(context.environments, item.environment)
    }
  }

  // A model that was set up and all removed: the environment is still the
  // team's, so more can be added to it.
  if (inEnvironment.length > 0) {
    return {
      ...card,
      addModelUrl: addModelUrl(team, item.environment),
      empty: true
    }
  }

  return {
    ...card,
    setUpUrl: environmentSetUpUrl(team.slug, item.environment)
  }
}

/**
 * The names of the environments a team cannot use yet, as one sentence, or
 * null when it can use them all.
 * @returns {string | null}
 */
function notAvailableYetSentence() {
  const names = teamEnvironmentList()
    .filter(({ available }) => !available)
    .map(({ name }) => name)

  if (names.length === 0) {
    return null
  }

  return `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} not available yet.`
}

/**
 * What the team's Models tab shows: a card for each environment the team can
 * use, with its models, client secret and limits, and how often to refresh
 * while anything is changing.
 * @param {object} params
 * @param {{_id: string, slug: string}} params.team
 * @param {boolean} params.isAdmin
 * @param {object[]} params.deployments - The team's deployments.
 * @param {object[] | null} params.credentials - The person's credentials, or null when they could not be read.
 * @param {Record<string, string>} params.modelNames - Display names by slug.
 * @param {Array<{environment: string, limits: object}>} [params.environments] - The environments the team has a file in, with their limits.
 * @returns {{cards: object[], notAvailableYet: string | null, refreshSeconds?: number}}
 */
export function buildModelsTab(params) {
  const cards = teamEnvironmentList()
    .filter(({ available }) => available)
    .map((item) => environmentCard(item, params))
  const changing = params.deployments.some(({ status }) =>
    isDeploymentInProgress(status)
  )

  return {
    cards,
    notAvailableYet: notAvailableYetSentence(),
    refreshSeconds: changing ? MODELS_CHANGING_REFRESH_SECONDS : undefined
  }
}

/**
 * The Models tab for a team. The deployments are what the page is about, so
 * a failure to list them is reported as such rather than shown as a team with
 * no models; the model names and the client secrets only add to it, so a
 * failure to read either does not take the page down.
 * @param {import('@hapi/hapi').Request} request
 * @param {{team: object, isAdmin: boolean, environments?: object[]}} loaded
 * @returns {Promise<{unavailable: boolean, cards: object[], notAvailableYet: string | null, refreshSeconds?: number}>}
 */
export async function loadModelsTab(request, { team, isAdmin, environments }) {
  const client = apiClient(request)
  const userId = getSessionUser(request).id
  // The names can be read alongside the deployments. The credentials are read
  // only once the deployments are: reading them lists the deployments afresh,
  // and a model that has just turned active has its team secret granted then,
  // so an earlier read of the credentials would miss it and the tab would
  // show a ready model beside a secret that is "not ready".
  const catalogueRead = settled(client.get('/v1/models?includeIneligible=true'))
  const deployments = await settled(
    client.get(`/v1/teams/${encodeURIComponent(team.slug)}/deployments`, {
      userId
    })
  )
  const credentials =
    deployments.status === 'fulfilled'
      ? await settled(client.get('/v1/credentials', { userId }))
      : null
  const catalogue = await catalogueRead

  for (const failed of [deployments, catalogue, credentials]) {
    if (failed?.status === 'rejected') {
      request.logger.warn(
        { err: failed.reason },
        'Could not read part of the team Models tab'
      )
    }
  }

  if (deployments.status === 'rejected') {
    return { unavailable: true, cards: [], notAvailableYet: null }
  }

  return {
    unavailable: false,
    ...buildModelsTab({
      team,
      isAdmin,
      environments,
      deployments: deployments.value.items,
      credentials:
        credentials.status === 'fulfilled' ? credentials.value.items : null,
      modelNames: Object.fromEntries(
        (catalogue.value?.items ?? []).map((model) => [
          model.slug,
          model.displayName
        ])
      )
    })
  }
}

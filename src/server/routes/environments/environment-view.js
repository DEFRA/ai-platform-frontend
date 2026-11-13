// What the Environments and deployments pages show, built from what the
// backend's team routes return: the cards of the overview, the strip, and an
// environment's own sections. Nothing here reads the backend or the request.
import { isSameDay, parseISO } from 'date-fns'

import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import {
  DEPLOYMENT_FAILURE_STATUSES,
  DEPLOYMENT_REMOVING_STATUS,
  deploymentStatusText,
  deploymentTagClass,
  isDeploymentInProgress
} from '#/server/common/helpers/deployment-status.js'
import {
  defaultTeamEnvironment,
  environmentPageUrl,
  environmentRegistryName,
  environmentSetUpUrl,
  teamEnvironmentList
} from '#/server/common/helpers/environment-names.js'
import {
  TEAM_SECRET_STATE,
  teamSecretFor
} from '#/server/routes/teams/team-secret.js'
import { teamUrl } from '#/server/routes/teams/team-view.js'
import { buildOperationItem } from './operation-view.js'

const ACTIVE_STATUS = 'active'
const START_URL = '/connect/team/start'

const numberFormat = new Intl.NumberFormat('en-GB')

const TAG_AVAILABLE = { text: 'Available', tagClass: 'govuk-tag--green' }
const TAG_PAUSED = { text: 'Paused', tagClass: 'govuk-tag--yellow' }
const TAG_NOT_AVAILABLE = {
  text: 'Not available yet',
  tagClass: 'govuk-tag--grey'
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

/**
 * Where "Deploy a model" starts the request journey with the team (and the
 * environment, from an environment's own page) already chosen.
 * @param {{slug: string}} team
 * @param {string} [environment]
 * @returns {string}
 */
export function deployUrl(team, environment) {
  const query = new URLSearchParams({ teamId: team.slug })

  if (environment) {
    query.set('environment', environment)
  }

  return `${START_URL}?${query}`
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * When a change happened: "Today at 10:20" or the date.
 * @param {string | null | undefined} at
 * @param {Date} [now]
 * @returns {string}
 */
export function formatWhen(at, now = new Date()) {
  if (!at) {
    return ''
  }

  return isSameDay(parseISO(at), now)
    ? `Today at ${formatDate(at, 'HH:mm')}`
    : formatDate(at, 'd MMMM')
}

function slots() {
  return teamEnvironmentList().map((item) => ({
    code: item.environment,
    name: environmentRegistryName(item.environment),
    displayName: item.name,
    available: item.available
  }))
}

/**
 * The environments as a strip, in the order a team meets them. The current
 * one is marked; one the team cannot use yet has no link.
 * @param {string} teamSlug
 * @param {string} [current] - The environment code of the page.
 * @returns {Array<{code: string, name: string, displayName: string, available: boolean, current: boolean, href: string | null}>}
 */
export function buildStrip(teamSlug, current) {
  return slots().map((slot) => ({
    ...slot,
    current: slot.code === current,
    href: slot.available ? environmentPageUrl(teamSlug, slot.code) : null
  }))
}

function latestChangeText(operation, { modelNames, now }) {
  if (!operation) {
    return 'None yet'
  }

  const { change, result } = buildOperationItem(operation, { modelNames })
  const when = formatWhen(operation.createdAt, now)
  const whenText = when ? `, ${lowerFirst(when)}` : ''

  return `${change}: ${result.text}${whenText}`
}

function tokensText(limits) {
  return typeof limits?.tokensPerMinute === 'number'
    ? numberFormat.format(limits.tokensPerMinute)
    : 'Not set up yet'
}

function availableCard(slot, summary, { team, modelNames, now }) {
  const card = {
    ...slot,
    tag: summary?.paused ? TAG_PAUSED : TAG_AVAILABLE,
    href: environmentPageUrl(team.slug, slot.code),
    linkText: `View ${slot.name}`,
    setUp: Boolean(summary?.setUp),
    setUpUrl: null,
    setUpText: null,
    notSetUp: null,
    pausedNote: summary?.paused
      ? `Changes wait here until the platform team resumes ${slot.name}.`
      : null,
    unreadable: !summary,
    rows: null
  }

  if (!summary) {
    return card
  }

  if (!summary.setUp) {
    const isFirst = slot.code === defaultTeamEnvironment()

    return {
      ...card,
      notSetUp: isFirst
        ? `Not set up yet. Deploy a model to set up ${slot.name}.`
        : 'Not set up yet.',
      setUpUrl: isFirst ? null : environmentSetUpUrl(team.slug, slot.code),
      setUpText: isFirst ? null : `Set up ${slot.name}`
    }
  }

  return {
    ...card,
    rows: [
      { key: 'Models', value: String(summary.models.count) },
      {
        key: 'Applications',
        value: `${summary.applications.used} of ${summary.applications.limit}`
      },
      { key: 'Tokens a minute', value: tokensText(summary.limits) },
      {
        key: 'Latest change',
        value: latestChangeText(summary.latestOperation, { modelNames, now })
      }
    ]
  }
}

/**
 * The overview's card for each environment slot: an available one with its
 * models, applications, token limit and latest change; one the team cannot
 * use yet greyed, with no actions.
 * @param {object} params
 * @param {{slug: string}} params.team
 * @param {object[]} params.summaries - The backend's environments, by code.
 * @param {Record<string, string>} params.modelNames
 * @param {Date} [params.now]
 * @returns {object[]}
 */
export function buildCards({ team, summaries, modelNames, now = new Date() }) {
  return slots().map((slot) => {
    if (!slot.available) {
      return {
        ...slot,
        tag: TAG_NOT_AVAILABLE,
        href: null,
        setUpUrl: null,
        message: `You cannot use ${slot.name} yet. It opens to teams here when it is ready.`
      }
    }

    const summary = summaries.find(
      ({ environment }) => environment === slot.code
    )

    return availableCard(slot, summary, { team, modelNames, now })
  })
}

function modelDetailLink(deployment, team, { failed, inProgress }) {
  if (failed) {
    return { text: 'See what happened', href: requestUrl(team, deployment) }
  }

  if (inProgress && deployment.status !== DEPLOYMENT_REMOVING_STATUS) {
    return { text: 'See progress', href: requestUrl(team, deployment) }
  }

  return null
}

// One model in the environment: its state, what a person can do about it and,
// for an admin, the way to remove it, which only a ready model has.
function modelRow(deployment, { team, isAdmin, modelNames }) {
  const { status } = deployment
  const failed = DEPLOYMENT_FAILURE_STATUSES.includes(status)
  const inProgress = isDeploymentInProgress(status)

  return {
    name: modelNames[deployment.modelSlug] ?? deployment.modelSlug,
    statusText: deploymentStatusText(status),
    tagClass: deploymentTagClass(status),
    inProgress,
    // A removal that failed returns the model as ready, with the reason.
    reason:
      status === ACTIVE_STATUS ? (deployment.failureReason ?? null) : null,
    detail: modelDetailLink(deployment, team, { failed, inProgress }),
    removeUrl:
      isAdmin && status === ACTIVE_STATUS
        ? `${teamUrl(team)}/models/${encodeURIComponent(deployment._id)}/remove`
        : null
  }
}

// The team's client secret for the environment: when it expires (only when
// the credential says so), and what a person can do with it. Admins view,
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
      ? `Expires ${formatDate(credential.expiresAt, 'd MMMM yyyy')}`
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

// A limit the team file does not hold is null, which reads "Not set", not 0.
function limitText(value) {
  return typeof value === 'number' ? numberFormat.format(value) : 'Not set'
}

function limitsView({ team, environment, detail, isAdmin }) {
  if (!detail.setUp || !detail.limits) {
    return null
  }

  const { pendingLimits } = detail

  return {
    tokensPerMinute: limitText(detail.limits.tokensPerMinute),
    requestsPerMinute: limitText(detail.limits.requestsPerMinute),
    pending: pendingLimits
      ? `Changing to ${numberFormat.format(pendingLimits.tokensPerMinute)} tokens and ${numberFormat.format(pendingLimits.requestsPerMinute)} requests a minute`
      : null,
    changeUrl:
      isAdmin && detail.limitBounds
        ? `${environmentPageUrl(team.slug, environment)}/limits`
        : null
  }
}

/**
 * An environment's own page: the strip with this one selected, then what is
 * changing here, its models, limits and recent changes.
 * @param {object} params
 * @param {{_id: string, slug: string, name: string}} params.team
 * @param {boolean} params.isAdmin
 * @param {{environment: string, registryName: string, name: string}} params.environment - The environment from `environmentFromAddress`.
 * @param {object} params.detail - The backend's environment read.
 * @param {{open: object[], recent: object[]}} params.operations - This environment's changes.
 * @param {Record<string, string>} params.modelNames
 * @param {object[] | null} params.credentials - The person's credentials, or null when they could not be read.
 * @param {Date} [params.now]
 * @returns {object}
 */
export function buildEnvironmentPage({
  team,
  isAdmin,
  environment: { environment, registryName, name },
  detail,
  operations,
  modelNames,
  credentials,
  now = new Date()
}) {
  const models = detail.models.map((deployment) =>
    modelRow(deployment, { team, isAdmin, modelNames })
  )

  return {
    heading: registryName,
    caption: team.name,
    displayName: name,
    strip: buildStrip(team.slug, environment),
    tag: detail.paused ? TAG_PAUSED : TAG_AVAILABLE,
    pausedNote: detail.paused
      ? `Changes wait here until the platform team resumes ${registryName}.`
      : null,
    deployUrl: deployUrl(team, environment),
    setUp: Boolean(detail.setUp),
    setUpUrl:
      !detail.setUp && environment !== defaultTeamEnvironment()
        ? environmentSetUpUrl(team.slug, environment)
        : null,
    changes: operations.open.map((operation) =>
      buildOperationItem(operation, { modelNames })
    ),
    recent: buildRecent(operations.recent, { modelNames, now }),
    models,
    secret:
      models.length > 0
        ? secretRow({
            team,
            environment,
            isAdmin,
            credentials,
            deployments: detail.models
          })
        : null,
    limits: limitsView({ team, environment, detail, isAdmin }),
    inProgress:
      operations.open.length > 0 ||
      Boolean(detail.inProgress) ||
      models.some(({ inProgress }) => inProgress)
  }
}

/**
 * Recent changes as a table's rows: when, where, what and how it went, and
 * for one that failed, why.
 * @param {object[]} operations
 * @param {{modelNames: Record<string, string>, now?: Date}} context
 * @returns {object[]}
 */
export function buildRecent(operations, { modelNames, now = new Date() }) {
  return operations.map((operation) => ({
    ...buildOperationItem(operation, { modelNames }),
    when: formatWhen(operation.createdAt, now)
  }))
}

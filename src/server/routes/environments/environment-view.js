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
import { teamUrl } from '#/server/routes/teams/team-view.js'
import { buildClientSecrets } from './client-secrets-view.js'
import { buildOperationItem } from './operation-view.js'
import { buildApplications, buildConnection } from './federation-view.js'
import {
  credentialsBanner,
  isDeployLocked,
  isEnvironmentLocked,
  lockContext,
  withDisabledEnvironment
} from '#/server/common/helpers/team-lock.js'

const ACTIVE_STATUS = 'active'
const START_URL = '/connect/team/start'

const numberFormat = new Intl.NumberFormat('en-GB')

const TAG_AVAILABLE = { text: 'Available', tagClass: 'govuk-tag--green' }
const TAG_DISABLED = { text: 'Disabled', tagClass: 'govuk-tag--grey' }
const TAG_PAUSED = { text: 'Paused', tagClass: 'govuk-tag--yellow' }
const TAG_NOT_AVAILABLE = {
  text: 'Not available yet',
  tagClass: 'govuk-tag--grey'
}

const NO_LOCK = { teamDisabled: false, disabledEnvironments: [] }

/**
 * Whether an environment is disabled: the backend says so on the environment
 * itself and in the team's list; either is enough to grey its actions.
 * @param {{disabledEnvironments: string[]}} lock
 * @param {string} environment - The environment code.
 * @param {{disabled?: boolean} | null | undefined} summary - The environment as read.
 * @returns {boolean}
 */
export function isDisabled(lock, environment, summary) {
  return Boolean(summary?.disabled) || isEnvironmentLocked(lock, environment)
}

// What an environment says it is: a lock is ahead of a pause.
function statusTag({ disabled, paused }) {
  if (disabled) {
    return TAG_DISABLED
  }

  return paused ? TAG_PAUSED : TAG_AVAILABLE
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

function availableCard(slot, summary, { team, modelNames, now, lock }) {
  const disabled = isDisabled(lock, slot.code, summary)
  const card = {
    ...slot,
    tag: statusTag({ disabled, paused: summary?.paused }),
    href: environmentPageUrl(team.slug, slot.code),
    linkText: `View ${slot.name}`,
    setUp: Boolean(summary?.setUp),
    setUpUrl: null,
    setUpText: null,
    setUpLocked: false,
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
      // Setting up an environment is a team-wide change, locked with the team.
      setUpUrl:
        isFirst || lock.teamDisabled
          ? null
          : environmentSetUpUrl(team.slug, slot.code),
      setUpText: isFirst ? null : `Set up ${slot.name}`,
      setUpLocked: !isFirst && lock.teamDisabled
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
 * @param {{teamDisabled: boolean, disabledEnvironments: string[]}} [params.lock] - What is locked for the team.
 * @param {Date} [params.now]
 * @returns {object[]}
 */
export function buildCards({
  team,
  summaries,
  modelNames,
  lock = NO_LOCK,
  now = new Date()
}) {
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

    return availableCard(slot, summary, { team, modelNames, now, lock })
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
// for an admin, the way to remove it, which only a ready model has. In a
// disabled environment the way to remove it is plain text.
function modelRow(deployment, { team, isAdmin, modelNames, locked }) {
  const { status } = deployment
  const failed = DEPLOYMENT_FAILURE_STATUSES.includes(status)
  const inProgress = isDeploymentInProgress(status)
  const removable = isAdmin && status === ACTIVE_STATUS

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
      removable && !locked
        ? `${teamUrl(team)}/models/${encodeURIComponent(deployment._id)}/remove`
        : null,
    removeLocked: removable && locked
  }
}

// A limit the team file does not hold is null, which reads "Not set", not 0.
function limitText(value) {
  return typeof value === 'number' ? numberFormat.format(value) : 'Not set'
}

function limitsView({ team, environment, detail, isAdmin, locked }) {
  if (!detail.setUp || !detail.limits) {
    return null
  }

  const { pendingLimits } = detail
  const changeable = isAdmin && Boolean(detail.limitBounds)

  return {
    tokensPerMinute: limitText(detail.limits.tokensPerMinute),
    requestsPerMinute: limitText(detail.limits.requestsPerMinute),
    pending: pendingLimits
      ? `Changing to ${numberFormat.format(pendingLimits.tokensPerMinute)} tokens and ${numberFormat.format(pendingLimits.requestsPerMinute)} requests a minute`
      : null,
    changeUrl:
      changeable && !locked
        ? `${environmentPageUrl(team.slug, environment)}/limits`
        : null,
    changeLocked: changeable && locked
  }
}

/**
 * An environment's own page: the strip with this one selected, then what is
 * changing here, its models, limits, client secrets, applications and recent
 * changes.
 * @param {object} params
 * @param {{_id: string, slug: string, name: string}} params.team
 * @param {boolean} params.isAdmin
 * @param {{environment: string, registryName: string, name: string}} params.environment - The environment from `environmentFromAddress`.
 * @param {object} params.detail - The backend's environment read.
 * @param {{open: object[], recent: object[]}} params.operations - This environment's changes.
 * @param {Record<string, string>} params.modelNames
 * @param {Record<string, object>} [params.catalogue] - The catalogue's models by slug, for the call a model takes.
 * @param {{teamDisabled: boolean, disabledEnvironments: string[]}} [params.lock] - What is locked for the team.
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
  catalogue = {},
  lock = NO_LOCK,
  now = new Date()
}) {
  const locked = isDisabled(lock, environment, detail)
  // The page's lock, with this environment in it when the backend says so on
  // the environment itself.
  const pageLock = locked ? withDisabledEnvironment(lock, environment) : lock
  const models = detail.models.map((deployment) =>
    modelRow(deployment, { team, isAdmin, modelNames, locked })
  )

  return {
    heading: registryName,
    caption: team.name,
    displayName: name,
    strip: buildStrip(team.slug, environment),
    tag: statusTag({ disabled: locked, paused: detail.paused }),
    ...lockContext(pageLock, environment),
    credentialsBanner: credentialsBanner(detail.credentialsDisabled),
    pausedNote: detail.paused
      ? `Changes wait here until the platform team resumes ${registryName}.`
      : null,
    deployUrl: deployUrl(team, environment),
    deployLocked: isDeployLocked(pageLock, environment, detail),
    setUp: Boolean(detail.setUp),
    setUpUrl:
      !detail.setUp &&
      environment !== defaultTeamEnvironment() &&
      !lock.teamDisabled
        ? environmentSetUpUrl(team.slug, environment)
        : null,
    setUpLocked:
      !detail.setUp &&
      environment !== defaultTeamEnvironment() &&
      lock.teamDisabled,
    changes: operations.open.map((operation) =>
      buildOperationItem(operation, { modelNames })
    ),
    recent: buildRecent(operations.recent, { modelNames, now }),
    models,
    limits: limitsView({ team, environment, detail, isAdmin, locked }),
    clientSecrets: buildClientSecrets({
      team,
      environment,
      registryName,
      detail,
      isAdmin,
      locked
    }),
    applications: buildApplications({
      team,
      environment,
      registryName,
      detail,
      isAdmin,
      locked
    }),
    connection: buildConnection({ detail, catalogue }),
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

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from './api-error.js'
import { teamEnvironmentsUrl } from './environment-names.js'

// The view-only lock a Platform Admin puts on a team (disable team). While the
// team's status is `disabled` its people can read every page but change none
// of the team-wide things (details, members, new environments); in each
// environment the admin also ticked (`disabledEnvironments`) they cannot change
// its models, limits, client secrets or applications either. The backend
// enforces it with `409 team-disabled`; these helpers only say it in the pages
// first. Nothing here says why: the team is never told.

export const TEAM_DISABLED = 'team-disabled'
export const CREDENTIALS_DISABLED = 'credentials-disabled'

const DISABLED_STATUS = 'disabled'
const CANNOT_CHANGE_HEADING = 'You cannot change this team'
const CANNOT_CHANGE_MESSAGE =
  'This team is disabled. You can view it but not change it.'
const ENVIRONMENT_LOCKED_MESSAGE =
  'This environment is disabled. You can view it but not change it.'
const CREDENTIALS_HEADING = 'Credentials are disabled'
const CREDENTIALS_MESSAGE =
  'Your team’s credentials are disabled here. You cannot add, view or rotate a client secret, or create or change a passwordless credential. You can still revoke a client secret and remove an application.'

/**
 * What is locked for a team, from what the backend gave of it.
 * @param {{status?: string, disabledEnvironments?: string[]} | null | undefined} team
 * @returns {{teamDisabled: boolean, disabledEnvironments: string[]}}
 */
export function teamLockOf(team) {
  return {
    teamDisabled: team?.status === DISABLED_STATUS,
    disabledEnvironments: Array.isArray(team?.disabledEnvironments)
      ? team.disabledEnvironments
      : []
  }
}

/**
 * Whether the team's environment actions are locked in one environment.
 * @param {{disabledEnvironments: string[]}} lock
 * @param {string | undefined} environment - The environment code.
 * @returns {boolean}
 */
export function isEnvironmentLocked(lock, environment) {
  return lock.disabledEnvironments.includes(environment)
}

/**
 * The lock with an environment added to its disabled ones, for a page whose
 * environment read says it is disabled.
 * @param {{teamDisabled: boolean, disabledEnvironments: string[]}} lock
 * @param {string} environment
 * @returns {{teamDisabled: boolean, disabledEnvironments: string[]}}
 */
export function withDisabledEnvironment(lock, environment) {
  return {
    ...lock,
    disabledEnvironments: [
      ...new Set([...lock.disabledEnvironments, environment])
    ]
  }
}

/**
 * Whether deploying a model in an environment is locked: the environment is
 * disabled, or the team is disabled and the environment is not set up yet
 * (setting one up is a team-wide change).
 * @param {{teamDisabled: boolean, disabledEnvironments: string[]}} lock
 * @param {string} environment
 * @param {{setUp?: boolean} | null | undefined} summary - The environment as read.
 * @returns {boolean}
 */
export function isDeployLocked(lock, environment, summary) {
  return (
    isEnvironmentLocked(lock, environment) ||
    Boolean(summary?.disabled) ||
    (lock.teamDisabled && !summary?.setUp)
  )
}

/**
 * Whether an error is the backend's refusal of a change to a disabled team.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isTeamDisabledError(error) {
  return error instanceof ApiError && error.code === TEAM_DISABLED
}

/**
 * Whether an error is the backend's refusal of a credential action while the
 * team's credentials are disabled in the environment.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isCredentialsDisabledError(error) {
  return error instanceof ApiError && error.code === CREDENTIALS_DISABLED
}

/**
 * The banner an environment's page shows while a Platform Admin has disabled
 * the team's credentials there: what can and cannot be done, never why.
 * @param {boolean | undefined} credentialsDisabled - From the backend's environment read.
 * @returns {{heading: string, message: string} | null}
 */
export function credentialsBanner(credentialsDisabled) {
  return credentialsDisabled
    ? { heading: CREDENTIALS_HEADING, message: CREDENTIALS_MESSAGE }
    : null
}

/**
 * The page for a credential action refused while the team's credentials are
 * disabled: 409, with a way back.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {{href: string, text: string}} back
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function credentialsDisabledPage(h, back) {
  return h
    .view('error/index', {
      pageTitle: CREDENTIALS_HEADING,
      heading: CREDENTIALS_HEADING,
      message: CREDENTIALS_MESSAGE,
      actionHref: back.href,
      actionText: back.text
    })
    .code(statusCodes.conflict)
}

/**
 * Where a refused credential action goes back to: the environments of the team
 * in the address, or the list of teams.
 * @param {import('@hapi/hapi').Request} request
 * @returns {{href: string, text: string}}
 */
export function credentialsDisabledBack(request) {
  const slug = request.params?.slug ?? request.params?.teamId

  return slug
    ? { href: teamEnvironmentsUrl(slug), text: 'Back to all environments' }
    : { href: '/teams', text: 'Go to your teams' }
}

/**
 * The banner a team's pages show while the team is disabled (or, on an
 * environment's page, while that environment is): what people can do, never
 * why.
 * @param {{teamDisabled: boolean, disabledEnvironments: string[]}} lock
 * @param {string} [environment] - The environment code of the page, if any.
 * @returns {{heading: string, message: string} | null}
 */
export function lockBanner(lock, environment) {
  if (lock.teamDisabled) {
    return {
      heading: 'This team is disabled',
      message: 'You can view it but you cannot change it.'
    }
  }

  return environment && isEnvironmentLocked(lock, environment)
    ? {
        heading: 'This environment is disabled',
        message: 'You can view it but you cannot change it.'
      }
    : null
}

/**
 * What a team page's template needs of the lock: the banner and whether the
 * team-wide actions are greyed.
 * @param {{teamDisabled: boolean, disabledEnvironments: string[]}} lock
 * @param {string} [environment]
 * @returns {{lockBanner: object | null, teamLocked: boolean}}
 */
export function lockContext(lock, environment) {
  return {
    lockBanner: lockBanner(lock, environment),
    teamLocked: lock.teamDisabled
  }
}

/**
 * The page for a change the team is not allowed to make while it is disabled:
 * 409, with a way back.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {{href: string, text: string}} back
 * @param {{environment?: boolean}} [options] - Say it of the environment, not the team.
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function teamDisabledPage(h, back, { environment = false } = {}) {
  return h
    .view('error/index', {
      pageTitle: CANNOT_CHANGE_HEADING,
      heading: CANNOT_CHANGE_HEADING,
      message: environment ? ENVIRONMENT_LOCKED_MESSAGE : CANNOT_CHANGE_MESSAGE,
      actionHref: back.href,
      actionText: back.text
    })
    .code(statusCodes.conflict)
}

/**
 * The page to show instead of a locked action's own page, or null when it is
 * not locked. With an environment the lock is that environment's; without,
 * the team's.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {{teamDisabled: boolean, disabledEnvironments: string[]}} lock
 * @param {{environment?: string, back: {href: string, text: string}}} where
 * @returns {import('@hapi/hapi').ResponseObject | null}
 */
export function lockedPage(h, lock, { environment, back }) {
  if (environment) {
    return isEnvironmentLocked(lock, environment)
      ? teamDisabledPage(h, back, { environment: !lock.teamDisabled })
      : null
  }

  return lock.teamDisabled ? teamDisabledPage(h, back) : null
}

/**
 * Where a refused change goes back to when the refusal came from the backend:
 * the page of the team in the address, or the list of teams.
 * @param {import('@hapi/hapi').Request} request
 * @returns {{href: string, text: string}}
 */
export function teamDisabledBack(request) {
  const slug = request.params?.slug ?? request.params?.teamId

  if (!slug) {
    return { href: '/teams', text: 'Go to your teams' }
  }

  return request.path.startsWith('/environments')
    ? { href: teamEnvironmentsUrl(slug), text: 'Back to all environments' }
    : { href: `/teams/${encodeURIComponent(slug)}`, text: 'Back to the team' }
}

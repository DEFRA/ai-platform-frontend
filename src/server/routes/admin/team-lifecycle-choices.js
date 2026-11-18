// What the Platform Admin's Disable team and Enable team pages offer and say,
// worked out from the backend's read of the team (`GET /v1/admin/teams/{id}`):
// which environments can be disabled, which are disabled and can be enabled,
// and whether the ones asked for are among them. Nothing here reads the
// backend or the request; the backend decides again on every call.
import { environmentName } from '#/server/common/helpers/environment-names.js'
import { environmentList } from './deployment-page.js'

const REMOVED = 'removed'

/**
 * Every environment code the team has, in the order the backend lists them,
 * and any it holds as disabled.
 * @param {{environments?: Array<{environment: string}>, disabledEnvironments?: string[]}} team
 * @returns {string[]}
 */
export function knownEnvironments(team) {
  return [
    ...new Set([
      ...(team.environments ?? []).map(({ environment }) => environment),
      ...(team.disabledEnvironments ?? [])
    ])
  ]
}

/**
 * The environments that are disabled: the backend marks each, and lists them
 * on the team too; either says so.
 * @param {{environments?: Array<{environment: string, disabled?: boolean}>, disabledEnvironments?: string[]}} team
 * @returns {string[]}
 */
export function disabledEnvironmentsOf(team) {
  const marked = (team.environments ?? [])
    .filter(({ disabled }) => disabled)
    .map(({ environment }) => environment)

  return [...new Set([...marked, ...(team.disabledEnvironments ?? [])])]
}

/**
 * The environments a Disable can offer: the team's own that are not disabled
 * already, and not one removed from the team.
 * @param {object} team
 * @returns {string[]}
 */
export function offeredToDisable(team) {
  const disabled = new Set(disabledEnvironmentsOf(team))

  return (team.environments ?? [])
    .filter(
      ({ environment, fileStatus }) =>
        fileStatus !== REMOVED && !disabled.has(environment)
    )
    .map(({ environment }) => environment)
}

/**
 * Whether the team has anything to enable: its own lock, or an environment's.
 * @param {{status?: string}} team
 * @returns {boolean}
 */
export function canEnable(team) {
  return team.status === 'disabled' || disabledEnvironmentsOf(team).length > 0
}

/**
 * Whether an environment is among those the action is offered for.
 * @param {string[]} requested - The codes asked for (may be none).
 * @param {{known: string[], offered: string[]}} choices
 * @returns {{environments: string[]} | {problem: 'unknown' | 'not-offered'}}
 */
export function resolveTeamEnvironments(requested, { known, offered }) {
  if (requested.some((environment) => !known.includes(environment))) {
    return { problem: 'unknown' }
  }

  return requested.every((environment) => offered.includes(environment))
    ? { environments: requested }
    : { problem: 'not-offered' }
}

/**
 * Checkbox items for "Which environments?".
 * @param {string[]} codes - The environments on offer.
 * @param {string[]} ticked - The codes to tick.
 * @returns {Array<{value: string, text: string, checked: boolean}>}
 */
export function teamEnvironmentChoices(codes, ticked) {
  return codes.map((environment) => ({
    value: environment,
    text: environmentName(environment),
    checked: ticked.includes(environment)
  }))
}

function areStill(names) {
  return names.length === 1 ? 'is still disabled' : 'are still disabled'
}

/**
 * What the team page says after an Enable: what was unlocked and what stays
 * disabled. A team that was already enabled is not said to be enabled by this
 * action: only the environments unlocked are.
 * @param {string[]} enabled - The environments unlocked.
 * @param {string[]} remaining - The environments that stay disabled.
 * @param {{teamWasDisabled?: boolean}} [options] - Whether the team itself was disabled before this action (default true).
 * @returns {string}
 */
export function enableMessage(
  enabled,
  remaining,
  { teamWasDisabled = true } = {}
) {
  const staying =
    remaining.length > 0
      ? ` ${environmentList(remaining)} ${areStill(remaining)}.`
      : ''

  if (!teamWasDisabled && enabled.length > 0) {
    return `${environmentList(enabled)} unlocked.${staying}`
  }

  const unlocked =
    enabled.length > 0 ? ` and ${environmentList(enabled)} unlocked` : ''

  return `Team enabled${unlocked}.${staying}`
}

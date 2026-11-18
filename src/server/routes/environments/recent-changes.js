// Recent changes: a team's changes to its files (operations) and the platform
// team's changes to its status (disable and enable), as one list, newest
// first, within one row limit. A status change reads the same to every member:
// no reason and no name, because the team is never told why or by whom.
import { environmentRegistryName } from '#/server/common/helpers/environment-names.js'
import { formatWhen } from './environment-view.js'

/** The most rows Recent changes shows, and the most each read asks for. */
export const RECENT_CHANGES = 10

const DONE = { text: 'Done', tagClass: 'govuk-tag--green' }

const STATUS_CHANGE_TEXT = {
  disabled: 'Team disabled by the platform team',
  enabled: 'Team enabled by the platform team'
}

function environmentsText(environments) {
  const names = (environments ?? []).map(environmentRegistryName)

  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * The rows for the team's status changes, as the table shows an operation.
 * A change the page does not know the words for is left out, so nothing
 * unexplained is shown.
 * @param {Array<{change: string, environments?: string[], at: string}>} changes
 * @param {{now?: Date}} [context]
 * @returns {object[]}
 */
export function buildStatusChangeRows(changes, { now = new Date() } = {}) {
  return changes
    .filter(({ change }) => Object.hasOwn(STATUS_CHANGE_TEXT, change))
    .map(({ change, environments, at }) => ({
      id: `status-${change}-${at}`,
      createdAt: at,
      when: formatWhen(at, now),
      change: STATUS_CHANGE_TEXT[change],
      environmentName: environmentsText(environments) || null,
      result: DONE,
      failure: null
    }))
}

/**
 * Operation rows and status change rows as one list, newest first, no longer
 * than the limit.
 * @param {object[]} operationRows - Rows from `buildRecent`.
 * @param {object[]} statusRows - Rows from `buildStatusChangeRows`.
 * @param {number} [limit]
 * @returns {object[]}
 */
export function mergeRecent(operationRows, statusRows, limit = RECENT_CHANGES) {
  return [...operationRows, ...statusRows]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit)
}

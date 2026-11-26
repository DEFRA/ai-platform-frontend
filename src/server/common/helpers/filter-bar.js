import { USAGE_DAYS } from '#/server/common/helpers/usage-format.js'

/**
 * The selector of a period, "Period: [ Last 30 days ]", for a page that shows
 * the last 7, 30 or 90 days.
 * @param {number} days - The period shown now.
 * @returns {{id: string, name: string, label: string, items: object[]}}
 */
export function periodSelectOf(days) {
  return {
    id: 'days',
    name: 'days',
    label: 'Period',
    items: USAGE_DAYS.map((option) => ({
      value: String(option),
      text: `Last ${option} days`,
      selected: option === days
    }))
  }
}

/**
 * The selector of a team, "Team: [ Flood Risk Team ]".
 * @param {Array<{slug: string, name: string}>} teams
 * @param {string} currentSlug
 * @returns {{id: string, name: string, label: string, items: object[]}}
 */
export function teamSelectOf(teams, currentSlug) {
  return {
    id: 'team',
    name: 'team',
    label: 'Team',
    items: teams.map((team) => ({
      value: team.slug,
      text: team.name,
      selected: team.slug === currentSlug
    }))
  }
}

/**
 * What the filter bar partial shows: the selectors of a page in one form that
 * asks `action` again with the new choice. `hidden` keeps the page's other
 * choices (a tab, an environment) when a selector changes.
 * @param {{action: string, selects: object[], hidden?: Array<{name: string, value: string}>, hint?: string}} options
 */
export function filterBarOf({ action, selects, hidden = [], hint }) {
  return {
    action,
    hidden,
    selects,
    hint:
      hint ??
      'Choosing an option updates the page. With a keyboard, press Enter after choosing.'
  }
}

const countFormat = new Intl.NumberFormat('en-GB')
const MS_PER_DAY = 86_400_000

export const USAGE_DAYS = [7, 30, 90]
export const DEFAULT_USAGE_DAYS = 30

/**
 * The number of days a usage address asks for: 7, 30 or 90, and 30 for
 * anything else, so a mistyped address still shows a page.
 * @param {unknown} value
 * @returns {number}
 */
export function usageDaysOf(value) {
  const days = Number(value)

  return USAGE_DAYS.includes(days) ? days : DEFAULT_USAGE_DAYS
}

/**
 * A whole number with thousands separators.
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  return countFormat.format(value)
}

/**
 * An estimated cost, or the words "Not available" when the backend has no
 * price to estimate it with: never 0, which would say it was free.
 * @param {number|null} cost
 * @param {string} currency - An ISO 4217 code.
 * @returns {string}
 */
export function formatCost(cost, currency) {
  return typeof cost === 'number'
    ? new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(
        cost
      )
    : 'Not available'
}

function longDate(milliseconds) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(milliseconds)
}

/**
 * A period in words: `from` is the first day and `to` the day after the
 * last, as the backend gives them.
 * @param {{from: string, to: string}} period
 * @returns {string}
 */
export function periodText({ from, to }) {
  const first = Date.parse(`${from}T00:00:00Z`)
  const last = Date.parse(`${to}T00:00:00Z`) - MS_PER_DAY

  return `${longDate(first)} to ${longDate(last)}`
}

/**
 * A UTC date as a short day for a table row.
 * @param {string} day - `YYYY-MM-DD`
 * @returns {string}
 */
export function formatDay(day) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(Date.parse(`${day}T00:00:00Z`))
}

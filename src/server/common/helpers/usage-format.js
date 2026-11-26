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

const MILLION = 1_000_000
const BILLION = 1_000_000_000
const THOUSAND = 1000

function compact(value, divisor, suffix) {
  const scaled = value / divisor

  return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`
}

/**
 * Tokens in the short form a card has room for: 12.3k, 439.1m, 2.27bn.
 * @param {number} value
 * @returns {string}
 */
export function formatTokens(value) {
  if (value >= BILLION) {
    return `${(value / BILLION).toFixed(2)}bn`
  }

  if (value >= MILLION) {
    return compact(value, MILLION, 'm')
  }

  return value >= THOUSAND
    ? compact(value, THOUSAND, 'k')
    : countFormat.format(value)
}

/**
 * Carbon in kilograms, or grams for a small amount, or "Not available" when
 * there is no figure: never 0 for a number nobody worked out.
 * @param {number|null} kilograms
 * @returns {string}
 */
export function formatCarbon(kilograms) {
  if (typeof kilograms !== 'number') {
    return 'Not available'
  }

  return kilograms < 1
    ? `${(kilograms * THOUSAND).toFixed(kilograms * THOUSAND < 10 ? 1 : 0)} g`
    : `${kilograms.toFixed(1)} kg`
}

/**
 * Electricity in kilowatt hours.
 * @param {number|null} kilowattHours
 * @returns {string}
 */
export function formatElectricity(kilowattHours) {
  return typeof kilowattHours === 'number'
    ? `${kilowattHours.toFixed(kilowattHours < 10 ? 1 : 0)} kWh`
    : 'Not available'
}

/**
 * A share as a whole percentage.
 * @param {number} share - 0 to 1.
 * @returns {string}
 */
export function formatPercent(share) {
  return `${Math.round(share * 100)}%`
}

/**
 * The month a key such as 2026-11 stands for, short for a chart axis.
 * @param {string} key - `YYYY-MM`
 * @returns {string}
 */
export function formatMonth(key) {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    timeZone: 'UTC'
  }).format(Date.parse(`${key}-01T00:00:00Z`))
}

/**
 * The month a key such as 2026-11 stands for, in full.
 * @param {string} key - `YYYY-MM`
 * @returns {string}
 */
export function formatMonthLong(key) {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(Date.parse(`${key}-01T00:00:00Z`))
}

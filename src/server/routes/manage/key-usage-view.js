import { differenceInCalendarDays } from 'date-fns'

import {
  RESEARCH_CREDENTIAL_DAYS,
  RESEARCH_RENEWAL_CAP
} from '#/server/common/constants/research-access.js'
import {
  progressBar,
  stackedBars
} from '#/server/common/helpers/usage-charts.js'
import {
  formatCount,
  formatDay,
  formatDayLong,
  formatPercent,
  formatTokens
} from '#/server/common/helpers/usage-format.js'

/** How many days of a key's use Personal access shows to start with. */
export const KEY_USAGE_DAYS = 7

const NEAR_LIMIT = 0.8
const DAY_OF_MONTH_FROM = 8
// The chart series that colour a day, as the Usage charts number them.
const SERIES_WITHIN = 0
const SERIES_NEAR = 3
const SERIES_FULL = 4

const WITHIN = { text: 'Within limit', colour: 'green', series: SERIES_WITHIN }
const NEAR = { text: 'Near the limit', colour: 'orange', series: SERIES_NEAR }
const FULL = { text: 'Limit reached', colour: 'red', series: SERIES_FULL }

function statusOf(share) {
  if (share >= 1) {
    return FULL
  }

  return share >= NEAR_LIMIT ? NEAR : WITHIN
}

// Today is the last day of the period the backend reads.
function usedTodayOf(usage) {
  return usage.byDay.at(-1)?.totalTokens ?? 0
}

function tokensRowOf(allowance, usage) {
  if (!allowance) {
    return null
  }

  const row = { figure: formatCount(allowance) }

  if (!usage) {
    return { ...row, bar: null, status: null, usedToday: null }
  }

  const used = usedTodayOf(usage)
  const share = used / allowance
  const status = statusOf(share)

  return {
    ...row,
    status,
    usedToday: formatCount(used),
    usedShare: formatPercent(share),
    bar: progressBar({
      label: `${formatCount(used)} of ${formatCount(allowance)} tokens used today`,
      share,
      series: status.series
    })
  }
}

function requestsRowOf(perMinute) {
  return perMinute ? { figure: formatCount(perMinute) } : null
}

function daysLeftText(days) {
  if (days === 0) {
    return 'Ends today'
  }

  return `${days} ${days === 1 ? 'day' : 'days'} left`
}

// The key's own time, from the backend's reading where there is one and from
// the key row where there is not.
function keyRowOf(row, usage) {
  const key = usage?.key
  const expiresAt = key?.expiresAt ?? row.expiresAt

  if (!expiresAt) {
    return null
  }

  const validDays = key?.validDays ?? RESEARCH_CREDENTIAL_DAYS
  const renewed = key?.renewalsUsed ?? row.renewalCount ?? 0
  const cap = key?.renewalCap ?? RESEARCH_RENEWAL_CAP
  const left = Math.max(
    differenceInCalendarDays(new Date(expiresAt), new Date()),
    0
  )

  return {
    figure: daysLeftText(left),
    bar: progressBar({
      label: `${left} of ${validDays} days left`,
      share: (validDays - left) / validDays,
      className: 'app-bar__time'
    }),
    note: `A key works for ${validDays} days. Renewed ${renewed} of ${cap} times.`
  }
}

function chartOf(usage, allowance, days) {
  const total = (day) => day.totalTokens
  const share = (day) => (allowance ? total(day) / allowance : 0)
  const reached = allowance
    ? usage.byDay.findLast((day) => total(day) >= allowance)
    : undefined

  return {
    chart: stackedBars({
      label: `Tokens used each day in the last ${days} days`,
      categories: usage.byDay.map((day) => ({
        label: String(Number(day.day.slice(DAY_OF_MONTH_FROM))),
        parts: [{ series: statusOf(share(day)).series, value: total(day) }]
      })),
      format: formatTokens,
      marker: allowance
        ? {
            value: allowance,
            label: `Your allowance, ${formatCount(allowance)} a day`
          }
        : undefined
    }),
    legend: allowance
      ? [
          { series: SERIES_WITHIN, text: 'Under 80% of your allowance' },
          { series: SERIES_NEAR, text: '80% or more' },
          { series: SERIES_FULL, text: 'All of it' }
        ]
      : [],
    table: usage.byDay.map((day) => ({
      label: formatDay(day.day),
      tokens: formatCount(total(day)),
      share: allowance ? formatPercent(share(day)) : null
    })),
    reachedText: reached
      ? `Your key used all of its allowance on ${formatDayLong(reached.day)}.`
      : null,
    totalText: `Used in the last ${days} days: ${formatTokens(usage.totals.totalTokens)} tokens in ${formatCount(usage.totals.requests)} requests.`
  }
}

/**
 * What Personal access shows of one key's allowance and use: what the model
 * allows (tokens a day and calls a minute, the catalogue's defaults, which the
 * portal shows and does not enforce), what the key has used today against
 * that, how long the key has left, and the tokens used each day. Without a
 * reading of the use, the limits and the key's time still show and the page
 * says the use could not be checked.
 * @param {{_id: string, modelDisplayName: string, expiresAt?: string, renewalCount?: number}} row - a key row.
 * @param {object | null} usage - the backend's key usage, or null when it could not be read.
 * @param {{tokensPerDay?: number, requestsPerMinute?: number}} limits - the model's default limits.
 * @param {number} days - The period read.
 */
export function keyUsageRowOf(row, usage, limits, days) {
  return {
    id: row._id,
    modelDisplayName: row.modelDisplayName,
    available: Boolean(usage),
    isMock: usage?.source === 'mock',
    tokensRow: tokensRowOf(limits.tokensPerDay, usage),
    requestsRow: requestsRowOf(limits.requestsPerMinute),
    keyRow: keyRowOf(row, usage),
    ...(usage ? chartOf(usage, limits.tokensPerDay, days) : {})
  }
}

/**
 * Personal access's "Your allowance and usage" section, for the keys that are
 * still working. With none, `rows` is empty and `empty` says why and where to
 * get one, so the section is always on the page.
 * @param {object[]} keyRows - from `buildKeyRows`.
 * @param {Array<object | null>} usages - one reading per key row, or null.
 * @param {Record<string, {tokensPerDay?: number, requestsPerMinute?: number}>} limits - the default limits by model slug.
 * @param {number} [days] - The period read, 7, 30 or 90.
 */
export function keyUsageOf(keyRows, usages, limits, days = KEY_USAGE_DAYS) {
  const rows = keyRows
    .map((row, index) => ({ row, usage: usages[index] }))
    .filter(({ row }) => !row.expired)
    .map(({ row, usage }) =>
      keyUsageRowOf(row, usage, limits[row.modelSlug] ?? {}, days)
    )

  return {
    days,
    isMock: rows.some((row) => row.isMock),
    many: rows.length > 1,
    rows,
    empty: rows.length > 0 ? null : emptyOf(keyRows)
  }
}

function emptyOf(keyRows) {
  return {
    text:
      keyRows.length === 0
        ? 'You do not have a key yet. Once you have one, its allowance and usage show here.'
        : 'Your key has expired. Once you have a new one, its allowance and usage show here.',
    linkText: 'Try a model on your own',
    href: '/connect/shared/start'
  }
}

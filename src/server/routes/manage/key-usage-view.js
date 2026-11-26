import {
  formatCount,
  formatTokens
} from '#/server/common/helpers/usage-format.js'

/** How many days of a key's use Personal access shows. */
export const KEY_USAGE_DAYS = 7

/**
 * The words and figures for one key's use over the last week, set beside the
 * model's default daily allowance. The allowance is the catalogue's default
 * for the model; the portal shows it and does not enforce it, so the page
 * says "default" and never "left" or "remaining". Without a reading, the row
 * says so rather than showing zeros.
 * @param {{_id: string, modelDisplayName: string}} row - a key row.
 * @param {object | null} usage - the backend's key usage, or null when it could not be read.
 * @param {number | undefined} allowance - the model's default tokens a day.
 */
export function keyUsageRowOf(row, usage, allowance) {
  const base = {
    id: row._id,
    modelDisplayName: row.modelDisplayName,
    allowanceText: allowance ? formatCount(allowance) : null
  }

  if (!usage) {
    return { ...base, available: false }
  }

  const peak = Math.max(0, ...usage.byDay.map((day) => day.totalTokens))

  return {
    ...base,
    available: true,
    isMock: usage.source === 'mock',
    tokens: formatTokens(usage.totals.totalTokens),
    requests: formatCount(usage.totals.requests),
    peakText: formatCount(peak),
    peakShare: allowance ? Math.min(peak / allowance, 1) : null
  }
}

/**
 * Personal access's "Your allowance and usage" section, for the keys that are
 * still working. Null when there are none to show.
 * @param {object[]} keyRows - from `buildKeyRows`.
 * @param {Array<object | null>} usages - one reading per key row, or null.
 * @param {Record<string, number | undefined>} allowances - default tokens a day by model slug.
 */
export function keyUsageOf(keyRows, usages, allowances) {
  const rows = keyRows
    .map((row, index) => ({ row, usage: usages[index] }))
    .filter(({ row }) => !row.expired)
    .map(({ row, usage }) =>
      keyUsageRowOf(row, usage, allowances[row.modelSlug])
    )

  if (rows.length === 0) {
    return null
  }

  return {
    days: KEY_USAGE_DAYS,
    isMock: rows.some((row) => row.isMock),
    rows
  }
}

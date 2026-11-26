import {
  formatCost,
  formatCount,
  formatDay,
  periodText
} from '#/server/common/helpers/usage-format.js'

const METER_MIN = 0

/**
 * What the team Usage page shows, from what the backend answered: the
 * period in words, the totals, a row for each day with how it compares to
 * the busiest, a row for each model, and the notices the figures need (an
 * estimate, a source that is not the gateway, a model with no price).
 * @param {{source: string, period: {from: string, to: string, days: number}, costBasis: {currency: string}, totals: object, byDay: object[], byModel: object[], unpricedModels: string[]}} usage
 */
export function usageViewOf(usage) {
  const { currency } = usage.costBasis
  const busiest = Math.max(
    METER_MIN,
    ...usage.byDay.map((day) => day.totalTokens)
  )

  return {
    days: usage.period.days,
    periodText: periodText(usage.period),
    isMock: usage.source === 'mock',
    hasUsage: usage.totals.requests > 0,
    totals: {
      requests: formatCount(usage.totals.requests),
      tokens: formatCount(usage.totals.totalTokens),
      promptTokens: formatCount(usage.totals.promptTokens),
      completionTokens: formatCount(usage.totals.completionTokens),
      cost: formatCost(usage.totals.estimatedCost, currency)
    },
    unpricedModels: usage.unpricedModels,
    byDay: usage.byDay.map((day) => ({
      label: formatDay(day.day),
      requests: formatCount(day.requests),
      tokens: formatCount(day.totalTokens),
      value: day.totalTokens,
      max: busiest
    })),
    byModel: usage.byModel.map((model) => ({
      model: model.modelSlug,
      requests: formatCount(model.requests),
      promptTokens: formatCount(model.promptTokens),
      completionTokens: formatCount(model.completionTokens),
      tokens: formatCount(model.totalTokens),
      cost: formatCost(model.estimatedCost, currency)
    }))
  }
}

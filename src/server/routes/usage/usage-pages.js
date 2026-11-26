import {
  formatCarbon,
  formatCount,
  formatDay,
  formatElectricity,
  formatMonth,
  formatMonthLong,
  formatPercent,
  formatTokens
} from '#/server/common/helpers/usage-format.js'
import { donut, stackedBars } from '#/server/common/helpers/usage-charts.js'
import { environmentRegistryName } from '#/server/common/helpers/environment-names.js'

const FORECAST_NOTE = 'at the rate so far this month'

function shortMoney(value, currency) {
  return typeof value === 'number'
    ? new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: value >= 100 ? 0 : 2
      }).format(value)
    : 'Not available'
}

function monthLabel(overview) {
  return formatMonthLong(overview.month.key)
}

function untilToday(overview) {
  const { key, daysElapsed } = overview.month

  return `1 to ${daysElapsed} ${monthLabel({ month: { key } }).split(' ')[0]}`
}

/**
 * The words for one thing that needs a team's attention.
 * @param {{kind: string, environment: string, count: number, days: number}} item
 * @param {string} slug
 * @returns {{text: string, href: string, linkText: string}}
 */
export function attentionOf(item, slug) {
  const name = environmentRegistryName(item.environment)

  return {
    text: `${name} had ${formatCount(item.count)} ${item.count === 1 ? 'call' : 'calls'} refused in the last ${item.days} days, because ${item.count === 1 ? 'it' : 'they'} went over the limit.`,
    href: `/environments/${encodeURIComponent(slug)}/${encodeURIComponent(item.environment)}/limits`,
    linkText: `View ${name} limits`
  }
}

function tabsOf(slug, current, carbonEnabled) {
  const base = `/usage/${encodeURIComponent(slug)}`

  return [
    { key: 'overview', text: 'Overview', href: base },
    { key: 'costs', text: 'Costs', href: `${base}/costs` },
    ...(carbonEnabled
      ? [{ key: 'carbon', text: 'Carbon', href: `${base}/carbon` }]
      : [])
  ].map((tab) => ({ ...tab, current: tab.key === current }))
}

// The page every Usage tab shares: whose usage, the tabs, and the notices the
// figures need.
function frameOf(overview, current) {
  return {
    teamName: overview.teamName,
    slug: overview.teamSlug,
    tabs: tabsOf(overview.teamSlug, current, overview.carbonBasis.enabled),
    isMock: overview.source === 'mock',
    unavailable: overview.unavailable.map(environmentRegistryName),
    unpricedModels: overview.unpricedModels,
    carbonEnabled: overview.carbonBasis.enabled,
    estimateNote: overview.carbonBasis.enabled
      ? 'Costs and carbon are estimates.'
      : 'Costs are estimates.',
    breadcrumbs: [
      { text: 'Home', href: '/' },
      current === 'overview'
        ? { text: 'Usage' }
        : {
            text: 'Usage',
            href: `/usage/${encodeURIComponent(overview.teamSlug)}`
          },
      ...(current === 'overview'
        ? []
        : [{ text: current === 'costs' ? 'Costs' : 'Carbon' }])
    ],
    period: `${untilToday(overview)} ${overview.month.key.slice(0, 4)}`
  }
}

function environmentLink(slug, environment) {
  return `/environments/${encodeURIComponent(slug)}/${encodeURIComponent(environment)}/usage`
}

/**
 * The Overview tab: four figures, what needs attention, the tokens of each
 * day, and the shares by model and environment.
 * @param {object} overview - The backend's answer.
 */
export function overviewViewOf(overview) {
  const { currency } = overview.costBasis
  const { totals, forecast } = overview.current
  const environments = overview.current.byEnvironment
  const seriesOf = new Map(
    environments.map((environment, index) => [environment.environment, index])
  )
  const dayChart = stackedBars({
    label: `Tokens each day in ${monthLabel(overview)}`,
    categories: overview.current.byDay.map((day) => ({
      label: String(Number(day.day.slice(8))),
      parts: Object.entries(day.byEnvironment).map(([environment, value]) => ({
        series: seriesOf.get(environment),
        value
      }))
    })),
    format: formatTokens
  })

  return {
    ...frameOf(overview, 'overview'),
    heading: 'Usage',
    intro: `What ${overview.teamName} has used and what it costs, in every environment.`,
    estimateNote: overview.carbonBasis.enabled
      ? 'Costs and carbon are estimates.'
      : 'Costs are estimates.',
    cards: [
      {
        value: formatTokens(totals.tokens),
        label: 'Tokens used',
        href: null,
        note: untilToday(overview)
      },
      {
        value: shortMoney(totals.cost, currency),
        label: 'Estimated cost',
        href: `/usage/${encodeURIComponent(overview.teamSlug)}/costs`,
        note:
          forecast.cost === null
            ? null
            : `Forecast ${shortMoney(forecast.cost, currency)} for ${monthLabel(overview).split(' ')[0]}`
      },
      {
        value: formatCount(totals.requests),
        label: 'Requests',
        href: null,
        note: untilToday(overview)
      },
      ...(overview.carbonBasis.enabled
        ? [
            {
              value: formatCarbon(totals.carbonKg),
              label: 'Carbon (CO₂e), estimated',
              href: `/usage/${encodeURIComponent(overview.teamSlug)}/carbon`,
              note:
                forecast.carbonKg === null
                  ? null
                  : `Forecast ${formatCarbon(forecast.carbonKg)} ${FORECAST_NOTE}`
            }
          ]
        : [])
    ],
    attention: overview.attention.map((item) =>
      attentionOf(item, overview.teamSlug)
    ),
    dayChart,
    legend: environments.map((environment, index) => ({
      series: index,
      name: environmentRegistryName(environment.environment),
      value: formatTokens(environment.tokens)
    })),
    dayTable: overview.current.byDay.map((day) => ({
      label: formatDay(day.day),
      tokens: formatCount(day.tokens)
    })),
    byModel: overview.current.byModel.map((model, index) => ({
      series: index,
      name: model.modelSlug,
      tokens: formatTokens(model.tokens),
      share: formatPercent(model.share),
      value: model.share,
      cost: shortMoney(model.cost, currency)
    })),
    byEnvironment: environments.map((environment, index) => ({
      series: index,
      name: environmentRegistryName(environment.environment),
      href: environmentLink(overview.teamSlug, environment.environment),
      tokens: formatTokens(environment.tokens),
      share: formatPercent(environment.share),
      value: environment.share,
      cost: shortMoney(environment.cost, currency)
    })),
    hasUsage: totals.requests > 0
  }
}

/**
 * The Costs tab: the estimated cost so far, the forecast and the cost for a
 * million tokens, the months, and the split by environment and model.
 * @param {object} overview - The backend's answer.
 */
export function costsViewOf(overview) {
  const { currency } = overview.costBasis
  const { totals, forecast } = overview.current
  const environments = overview.current.byEnvironment
  const last = overview.months.length - 1
  const monthChart = stackedBars({
    label: 'Estimated cost each month',
    categories: overview.months.map((month, index) => ({
      label: formatMonth(month.key),
      parts: [{ series: 0, value: month.cost ?? 0 }],
      forecast:
        index === last && forecast.cost !== null && totals.cost !== null
          ? Math.max(0, forecast.cost - totals.cost)
          : 0
    })),
    format: (value) => shortMoney(value, currency)
  })

  return {
    ...frameOf(overview, 'costs'),
    estimateNote: 'Every cost is an estimate.',
    heading: 'Costs',
    intro: `What ${overview.teamName}'s usage costs.`,
    cards: [
      {
        value: shortMoney(totals.cost, currency),
        label: 'Estimated cost so far',
        note: untilToday(overview)
      },
      {
        value: shortMoney(forecast.cost, currency),
        label: `Forecast for ${monthLabel(overview).split(' ')[0]}`,
        note: FORECAST_NOTE
      },
      {
        value: shortMoney(totals.costPerMillionTokens, currency),
        label: 'For a million tokens',
        note: 'Across every model the team uses'
      }
    ],
    monthChart,
    monthLegend: [
      { className: 'app-chart__s0', text: 'Estimated cost' },
      {
        className: 'app-chart__forecast',
        text: 'Forecast for the rest of the month'
      }
    ],
    monthTable: overview.months.map((month) => ({
      label: formatMonthLong(month.key),
      cost: shortMoney(month.cost, currency)
    })),
    environmentDonut: donut({
      label: 'Estimated cost by environment',
      parts: environments.map((environment, index) => ({
        series: index,
        value: environment.cost ?? 0
      })),
      centre: shortMoney(totals.cost, currency),
      caption: 'so far'
    }),
    byEnvironment: environments.map((environment, index) => ({
      series: index,
      name: environmentRegistryName(environment.environment),
      href: environmentLink(overview.teamSlug, environment.environment),
      cost: shortMoney(environment.cost, currency),
      share: formatPercent(
        totals.cost > 0 && environment.cost !== null
          ? environment.cost / totals.cost
          : 0
      )
    })),
    byModel: overview.current.byModel.map((model, index) => ({
      series: index,
      name: model.modelSlug,
      input: formatTokens(model.promptTokens),
      output: formatTokens(model.completionTokens),
      price: model.price
        ? `${shortMoney(model.price.inputPerMillion, currency)} and ${shortMoney(model.price.outputPerMillion, currency)}`
        : 'No price yet',
      cost: shortMoney(model.cost, currency),
      share: formatPercent(
        totals.cost > 0 && model.cost !== null ? model.cost / totals.cost : 0
      ),
      value:
        totals.cost > 0 && model.cost !== null ? model.cost / totals.cost : 0
    })),
    totalCost: shortMoney(totals.cost, currency),
    priceVersion: overview.costBasis.priceVersion,
    currency,
    hasUsage: totals.requests > 0
  }
}

/**
 * The Carbon tab (only when the backend says carbon is on).
 * @param {object} overview - The backend's answer.
 */
export function carbonViewOf(overview) {
  const { totals, forecast } = overview.current
  const last = overview.months.length - 1
  const models = overview.current.byModel
  const totalCarbon = totals.carbonKg
  const monthChart = stackedBars({
    label: 'Estimated carbon each month',
    categories: overview.months.map((month, index) => ({
      label: formatMonth(month.key),
      parts: [{ series: 0, value: month.carbonKg ?? 0 }],
      forecast:
        index === last && forecast.carbonKg !== null && totalCarbon !== null
          ? Math.max(0, forecast.carbonKg - totalCarbon)
          : 0
    })),
    format: (value) => `${Math.round(value * 10) / 10} kg`
  })

  return {
    ...frameOf(overview, 'carbon'),
    estimateNote: 'Every figure is an estimate.',
    heading: 'Carbon',
    intro: `An estimate of the carbon from the electricity ${overview.teamName}'s model calls use.`,
    cards: [
      {
        value: formatCarbon(totalCarbon),
        label: 'Carbon (CO₂e) so far',
        note: untilToday(overview)
      },
      {
        value: formatCarbon(forecast.carbonKg),
        label: `Forecast for ${monthLabel(overview).split(' ')[0]}`,
        note: FORECAST_NOTE
      },
      {
        value: formatElectricity(totals.electricityKwh),
        label: 'Electricity so far',
        note: 'Running the models and cooling them'
      },
      {
        value:
          typeof totals.carbonGramsPerMillionTokens === 'number'
            ? `${Math.round(totals.carbonGramsPerMillionTokens)} g`
            : 'Not available',
        label: 'For a million tokens',
        note: 'Across every model the team uses'
      }
    ],
    monthChart,
    monthLegend: [
      { className: 'app-chart__s0', text: 'Estimated carbon (CO₂e)' },
      {
        className: 'app-chart__forecast',
        text: 'Forecast for the rest of the month'
      }
    ],
    monthTable: overview.months.map((month) => ({
      label: formatMonthLong(month.key),
      carbon: formatCarbon(month.carbonKg)
    })),
    tokensDonut: donut({
      label: 'Share of tokens by model',
      parts: models.map((model, index) => ({
        series: index,
        value: model.tokens
      })),
      centre: formatTokens(totals.tokens)
    }),
    carbonDonut: donut({
      label: 'Share of carbon by model',
      parts: models.map((model, index) => ({
        series: index,
        value: model.carbonKg ?? 0
      })),
      centre: formatCarbon(totalCarbon)
    }),
    byModel: models.map((model, index) => ({
      series: index,
      name: model.modelSlug,
      tokens: formatTokens(model.tokens),
      tokenShare: formatPercent(model.share),
      carbon: formatCarbon(model.carbonKg),
      carbonShare: formatPercent(
        totalCarbon > 0 && model.carbonKg !== null
          ? model.carbonKg / totalCarbon
          : 0
      ),
      value:
        totalCarbon > 0 && model.carbonKg !== null
          ? model.carbonKg / totalCarbon
          : 0
    })),
    hasUsage: totals.requests > 0
  }
}

/**
 * The costs as a CSV, one row for each environment and model, for the month so
 * far.
 * @param {object} overview - The backend's answer.
 * @returns {string}
 */
export function costsCsvOf(overview) {
  const header = [
    'Month',
    'Model',
    'Requests',
    'Input tokens',
    'Output tokens',
    `Estimated cost (${overview.costBasis.currency})`
  ]
  const rows = overview.current.byModel.map((model) => [
    overview.month.key,
    model.modelSlug,
    model.requests,
    model.promptTokens,
    model.completionTokens,
    model.cost === null ? '' : model.cost.toFixed(2)
  ])

  return [header, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\r\n')
    .concat('\r\n')
}

// A cell that starts with = + - or @ is read by a spreadsheet as a formula, so
// it is quoted and given a leading apostrophe.
function csvCell(value) {
  const text = String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text

  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/**
 * What Home shows of usage: a figure card row for one team, or a table for
 * several, and each team's attention items.
 * @param {{items: object[]}} summary
 */
export function homeUsageOf(summary) {
  const ready = summary.items.filter((item) => item.available)

  if (summary.items.length === 0) {
    return null
  }

  const first = ready[0]
  const monthName = first ? formatMonthLong(first.month.key) : null
  const rows = ready.map((item) => {
    const currency = item.costBasis.currency

    return {
      name: item.name,
      href: `/usage/${encodeURIComponent(item.slug)}`,
      tokens: formatTokens(item.totals.tokens),
      cost: shortMoney(item.totals.cost, currency),
      forecast: shortMoney(item.forecast.cost, currency)
    }
  })

  return {
    monthName,
    href:
      ready.length === 1 ? `/usage/${encodeURIComponent(first.slug)}` : null,
    teamName: ready.length === 1 ? first.name : null,
    isMock: ready.some((item) => item.source === 'mock'),
    cards:
      ready.length === 1
        ? [
            {
              value: formatTokens(first.totals.tokens),
              label: 'Tokens used',
              note: `1 to ${first.month.daysElapsed} ${monthName.split(' ')[0]}`
            },
            {
              value: shortMoney(first.totals.cost, first.costBasis.currency),
              label: 'Estimated cost',
              note:
                first.forecast.cost === null
                  ? null
                  : `Forecast ${shortMoney(first.forecast.cost, first.costBasis.currency)} for ${monthName.split(' ')[0]}`
            },
            ...(first.carbonBasis.enabled
              ? [
                  {
                    value: formatCarbon(first.totals.carbonKg),
                    label: 'Carbon (CO₂e), estimated',
                    note:
                      first.forecast.carbonKg === null
                        ? null
                        : `Forecast ${formatCarbon(first.forecast.carbonKg)} ${FORECAST_NOTE}`
                  }
                ]
              : [])
          ]
        : [],
    rows: ready.length > 1 ? rows : [],
    unavailable: summary.items
      .filter((item) => !item.available)
      .map((item) => item.name),
    attention: ready.flatMap((item) =>
      item.attention.map((one) => {
        const words = attentionOf(one, item.slug)

        return { ...words, text: `${item.name}: ${words.text}` }
      })
    )
  }
}

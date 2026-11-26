import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import {
  defaultTeamEnvironment,
  environmentFromAddress,
  teamEnvironmentList
} from '#/server/common/helpers/environment-names.js'
import {
  filterBarOf,
  periodSelectOf
} from '#/server/common/helpers/filter-bar.js'
import { pageOfRows } from '#/server/common/helpers/pagination.js'
import {
  formatCost,
  formatCount,
  formatPercent,
  formatTokens,
  periodText,
  usageDaysOf
} from '#/server/common/helpers/usage-format.js'
import { donut } from '#/server/common/helpers/usage-charts.js'
import {
  ADMIN_TEAMS_URL,
  ADMIN_USAGE_URL,
  adminRefusalView,
  adminTabs,
  adminTeamUrl
} from './admin-page.js'

const USAGE_NOT_AVAILABLE = 'usage-not-available'
const ENVIRONMENT_NOT_AVAILABLE = 'environment-not-available'

function usageUrl(environment, days, page) {
  const paged = page > 1 ? `&page=${page}` : ''

  return `${ADMIN_USAGE_URL}?environment=${encodeURIComponent(environment)}&days=${days}${paged}`
}

function rowOf(item, currency) {
  return {
    requests: formatCount(item.requests),
    tokens: formatCount(item.totalTokens),
    cost: formatCost(item.estimatedCost, currency)
  }
}

const RING_SERIES = 6
const PERSONAL_ACCESS_API = 'research'

function sumOf(items, field) {
  return items.reduce((sum, item) => sum + item[field], 0)
}

// The teams' cost, or null when any one has no price: a total that leaves a
// team out would say less than was spent.
function teamCostOf(teams) {
  return teams.every((team) => typeof team.estimatedCost === 'number')
    ? sumOf(teams, 'estimatedCost')
    : null
}

// The ring and its legend: the busiest teams each get a colour and the rest
// share the last one, so a long list never runs out of colours.
function teamShareOf(teams) {
  const used = teams.filter((team) => team.totalTokens > 0)
  const total = sumOf(used, 'totalTokens')
  const shown =
    used.length > RING_SERIES ? used.slice(0, RING_SERIES - 1) : used
  const rest = used.slice(shown.length)
  const entries = [
    ...shown.map((team) => ({ name: team.name, tokens: team.totalTokens })),
    ...(rest.length
      ? [{ name: 'Other teams', tokens: sumOf(rest, 'totalTokens') }]
      : [])
  ].map((entry, index) => ({
    ...entry,
    series: index,
    share: entry.tokens / total
  }))

  return {
    shares: new Map(
      used.map((team) => [team.teamId, team.totalTokens / total])
    ),
    ring: total
      ? {
          chart: donut({
            label: 'Tokens used by each team',
            parts: entries.map(({ series, tokens }) => ({
              series,
              value: tokens
            })),
            centre: formatTokens(total),
            caption: 'tokens'
          }),
          legend: entries.map((entry) => ({
            series: entry.series,
            name: entry.name,
            value: `${formatTokens(entry.tokens)}, ${formatPercent(entry.share)}`
          }))
        }
      : null
  }
}

/**
 * What the Admin Usage page shows of the backend's answer: the figures across
 * every team, a row for each team (busiest first, with its share of the
 * tokens, 10 to a page), Personal access on its own, and the gateway APIs no
 * team owns.
 * @param {{source: string, period: {from: string, to: string}, costBasis: {currency: string}, teams: object[], otherApis: object[]}} usage
 * @param {{page?: string, href?: (page: number) => string}} [paging] - The page of the teams table asked for, and the address of a page.
 */
export function adminUsageViewOf(
  usage,
  { page, href = (number) => `?page=${number}` } = {}
) {
  const { currency } = usage.costBasis
  const { shares, ring } = teamShareOf(usage.teams)
  const personal = usage.otherApis.find(
    (api) => api.apiId === PERSONAL_ACCESS_API
  )
  const teamsPage = pageOfRows(
    usage.teams.map((team) => ({
      name: team.name,
      href: adminTeamUrl({ id: team.teamId }),
      serviceCode: team.serviceCode ?? 'Not set',
      share: shares.get(team.teamId) ?? 0,
      shareText: formatPercent(shares.get(team.teamId) ?? 0),
      ...rowOf(team, currency)
    })),
    { page, href }
  )

  return {
    periodText: periodText(usage.period),
    isMock: usage.source === 'mock',
    cards: [
      {
        value: formatTokens(sumOf(usage.teams, 'totalTokens')),
        label: 'Tokens used by teams'
      },
      {
        value: formatCost(teamCostOf(usage.teams), currency),
        label: 'Estimated cost of teams'
      },
      {
        value: formatCount(sumOf(usage.teams, 'requests')),
        label: 'Requests by teams'
      },
      {
        value: `${usage.teams.filter((team) => team.requests > 0).length} of ${usage.teams.length}`,
        label: 'Teams with use'
      },
      ...(personal
        ? [
            {
              value: formatTokens(personal.totalTokens),
              label: 'Personal access tokens',
              note: `${formatCount(personal.requests)} requests, met by the Research cost centre`
            }
          ]
        : [])
    ],
    ring,
    teams: teamsPage.rows,
    teamsPage,
    otherApis: usage.otherApis.map((api) => ({
      apiId: api.apiId,
      ...rowOf(api, currency)
    }))
  }
}

function notFoundView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Environment not found',
      heading: 'Environment not found',
      message: 'This environment does not exist or is not available yet.',
      actionHref: ADMIN_TEAMS_URL,
      actionText: 'Back to the Admin area'
    })
    .code(statusCodes.notFound)
}

function usageView(h, { environment, days, usage, page }) {
  return h.view('admin/usage', {
    pageTitle: 'Usage - Admin',
    heading: 'Usage',
    breadcrumbs: [
      { text: 'Home', href: '/' },
      { text: 'Admin', href: ADMIN_TEAMS_URL },
      { text: 'Usage' }
    ],
    tabs: adminTabs('usage'),
    environmentLabel: environment.registryName,
    environmentTabs: teamEnvironmentList()
      .filter((item) => item.available)
      .map((item) => ({
        text: item.name,
        href: usageUrl(item.environment, days),
        current: item.environment === environment.environment
      })),
    filterBar: filterBarOf({
      action: ADMIN_USAGE_URL,
      hidden: [{ name: 'environment', value: environment.environment }],
      selects: [periodSelectOf(days)],
      hint: 'Choosing a period updates the page. With a keyboard, press Enter after choosing.'
    }),
    notAvailable: usage === undefined,
    ...(usage &&
      adminUsageViewOf(usage, {
        page,
        href: (number) => usageUrl(environment.environment, days, number)
      }))
  })
}

async function showUsage(request, h) {
  const environment = environmentFromAddress(
    request.query.environment ?? defaultTeamEnvironment()
  )

  if (!environment) {
    return notFoundView(h)
  }

  const days = usageDaysOf(request.query.days)

  try {
    const usage = await apiClient(request).get(
      `/v1/admin/environments/${encodeURIComponent(environment.environment)}/usage?days=${days}`
    )

    return usageView(h, { environment, days, usage, page: request.query.page })
  } catch (error) {
    if (error instanceof ApiError && error.code === USAGE_NOT_AVAILABLE) {
      return usageView(h, { environment, days })
    }

    // Enabled here but not offered by the backend: the environment is missing,
    // not a team, which is all adminRefusalView would say of a 404.
    if (error instanceof ApiError && error.code === ENVIRONMENT_NOT_AVAILABLE) {
      return notFoundView(h)
    }

    return adminRefusalView(request, h, error)
  }
}

/**
 * The Platform Admin's Usage tab: every team's requests, tokens and estimated
 * cost in one environment over the last 7, 30 or 90 days, and the gateway
 * APIs no team owns. The page asks the backend on every request; the backend
 * decides who may read it and records a refusal (plan D2).
 */
export const adminUsageController = {
  handler: showUsage
}

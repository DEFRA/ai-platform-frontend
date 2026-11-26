import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import {
  defaultTeamEnvironment,
  environmentFromAddress,
  teamEnvironmentList
} from '#/server/common/helpers/environment-names.js'
import {
  USAGE_DAYS,
  formatCost,
  formatCount,
  periodText,
  usageDaysOf
} from '#/server/common/helpers/usage-format.js'
import {
  ADMIN_TEAMS_URL,
  ADMIN_USAGE_URL,
  adminRefusalView,
  adminTabs,
  adminTeamUrl
} from './admin-page.js'

const USAGE_NOT_AVAILABLE = 'usage-not-available'

function usageUrl(environment, days) {
  return `${ADMIN_USAGE_URL}?environment=${encodeURIComponent(environment)}&days=${days}`
}

function rowOf(item, currency) {
  return {
    requests: formatCount(item.requests),
    tokens: formatCount(item.totalTokens),
    cost: formatCost(item.estimatedCost, currency)
  }
}

/**
 * What the Admin Usage page shows of the backend's answer: a row for each
 * team, busiest first, and the gateway APIs no team owns.
 * @param {{source: string, period: {from: string, to: string}, costBasis: {currency: string}, teams: object[], otherApis: object[]}} usage
 */
export function adminUsageViewOf(usage) {
  const { currency } = usage.costBasis

  return {
    periodText: periodText(usage.period),
    isMock: usage.source === 'mock',
    teams: usage.teams.map((team) => ({
      name: team.name,
      href: adminTeamUrl({ id: team.teamId }),
      serviceCode: team.serviceCode ?? 'Not set',
      ...rowOf(team, currency)
    })),
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

function usageView(h, { environment, days, usage }) {
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
    periodLinks: USAGE_DAYS.map((option) => ({
      days: option,
      href: usageUrl(environment.environment, option),
      current: option === days
    })),
    notAvailable: usage === undefined,
    ...(usage && adminUsageViewOf(usage))
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

    return usageView(h, { environment, days, usage })
  } catch (error) {
    if (error instanceof ApiError && error.code === USAGE_NOT_AVAILABLE) {
      return usageView(h, { environment, days })
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

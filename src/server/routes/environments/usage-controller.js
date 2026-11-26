import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  environmentFromAddress,
  environmentPageUrl
} from '#/server/common/helpers/environment-names.js'
import {
  filterBarOf,
  periodSelectOf
} from '#/server/common/helpers/filter-bar.js'
import { usageDaysOf } from '#/server/common/helpers/usage-format.js'
import { isNotFound, loadTeamForView } from '#/server/routes/teams/team-view.js'
import { environmentNotFound, errorPage, teamNotFound } from './error-views.js'
import { isUnavailable, readTeamUsage } from './environments-api.js'
import { usageViewOf } from './usage-view.js'

const ENVIRONMENT_NOT_AVAILABLE = 'environment-not-available'
const USAGE_NOT_AVAILABLE = 'usage-not-available'

function usageUrl(slug, environment, days) {
  return `${environmentPageUrl(slug, environment)}/usage?days=${days}`
}

function back(slug, environment) {
  return {
    href: environmentPageUrl(slug, environment.environment),
    text: `Back to ${environment.registryName}`
  }
}

// The page for a read the backend refused or could not do, or `undefined` for
// a fault, which is thrown. The same 404 for a team that is not the person's
// as for one that does not exist.
function refusalPage(request, h, error, { slug, environment, days }) {
  if (isNotFound(error)) {
    if (error.code === ENVIRONMENT_NOT_AVAILABLE) {
      return environmentNotFound(h, slug)
    }

    return error.code === USAGE_NOT_AVAILABLE
      ? errorPage(h, {
          status: statusCodes.notFound,
          heading: `Usage is not available in ${environment.registryName} yet`,
          message: `We cannot show usage for ${environment.registryName} yet.`,
          back: back(slug, environment)
        })
      : teamNotFound(h)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not read usage')

    return errorPage(h, {
      status: statusCodes.serviceUnavailable,
      heading: 'Usage is not available just now',
      message: 'We could not read usage just now. Try again in a moment.',
      back: {
        href: usageUrl(slug, environment.environment, days),
        text: 'Try again'
      }
    })
  }

  return undefined
}

async function showUsage(request, h) {
  const { slug } = request.params
  const environment = environmentFromAddress(request.params.environment)

  if (!environment) {
    return environmentNotFound(h, slug)
  }

  const days = usageDaysOf(request.query.days)
  let usage
  let loaded

  try {
    usage = await readTeamUsage(request, slug, environment.environment, days)
    loaded = await loadTeamForView(request, slug)
  } catch (error) {
    const page = refusalPage(request, h, error, { slug, environment, days })

    if (page) {
      return page
    }

    throw error
  }

  const heading = `Usage in ${environment.registryName}`

  return h.view('environments/usage', {
    pageTitle: heading,
    heading,
    teamName: loaded.team.name,
    backLink: environmentPageUrl(slug, environment.environment),
    environmentName: environment.registryName,
    filterBar: filterBarOf({
      action: `${environmentPageUrl(slug, environment.environment)}/usage`,
      selects: [periodSelectOf(days)],
      hint: 'Choosing a period updates the page. With a keyboard, press Enter after choosing.'
    }),
    ...usageViewOf(usage)
  })
}

/**
 * A team's Usage page for one environment: what its models were asked and
 * what that came to, over the last 7, 30 or 90 days. Any member of the team;
 * the backend answers for the person's own team only.
 */
export const usageController = {
  handler: showUsage
}

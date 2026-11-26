import { statusCodes } from '#/server/common/constants/status-codes.js'
import { isNotFound, loadTeamForView } from '#/server/routes/teams/team-view.js'
import {
  errorPage,
  teamNotFound
} from '#/server/routes/environments/error-views.js'
import { isUnavailable } from '#/server/routes/environments/environments-api.js'
import { readUsageOverview, readUsageSummary } from './usage-api.js'
import {
  carbonViewOf,
  costsCsvOf,
  costsViewOf,
  overviewViewOf
} from './usage-pages.js'

const USAGE_NOT_AVAILABLE = 'usage-not-available'
const BACK_TO_USAGE = { href: '/usage', text: 'Go to Usage' }

// The page for a read the backend refused or could not do, or `undefined` for
// a fault, which is thrown. A team that is not the person's is the same 404 as
// one that does not exist.
function refusalPage(request, h, error, address) {
  if (isNotFound(error)) {
    return error.code === USAGE_NOT_AVAILABLE
      ? errorPage(h, {
          status: statusCodes.notFound,
          heading: 'Usage is not available yet',
          message: 'We cannot show usage for this team yet.',
          back: BACK_TO_USAGE
        })
      : teamNotFound(h)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not read usage')

    return errorPage(h, {
      status: statusCodes.serviceUnavailable,
      heading: 'Usage is not available just now',
      message: 'We could not read usage just now. Try again in a moment.',
      back: { href: address, text: 'Try again' }
    })
  }

  return undefined
}

async function withOverview(request, h, view) {
  const { slug } = request.params

  try {
    return await view(await readUsageOverview(request, slug))
  } catch (error) {
    const page = refusalPage(request, h, error, request.path)

    if (page) {
      return page
    }

    throw error
  }
}

function tabPage(h, template, view, titleSuffix) {
  return h.view(template, {
    pageTitle: `${view.heading} - ${titleSuffix}`,
    ...view
  })
}

/**
 * The Usage section: which team, then that team's Overview, Costs and Carbon.
 * Any member of the team reads it; the backend answers for the person's own
 * team only, so another team's address is the same 404 as one that does not
 * exist.
 */
export const usageController = {
  async chooser(request, h) {
    try {
      const { items } = await readUsageSummary(request)

      if (items.length === 1) {
        return h.redirect(`/usage/${encodeURIComponent(items[0].slug)}`)
      }

      return h.view('usage/chooser', {
        pageTitle: 'Usage',
        heading: 'Usage',
        teams: items.map((item) => ({
          name: item.name,
          href: `/usage/${encodeURIComponent(item.slug)}`
        }))
      })
    } catch (error) {
      const page = refusalPage(request, h, error, request.path)

      if (page) {
        return page
      }

      throw error
    }
  },

  overview: (request, h) =>
    withOverview(request, h, (overview) =>
      tabPage(h, 'usage/overview', overviewViewOf(overview), overview.teamName)
    ),

  costs: (request, h) =>
    withOverview(request, h, (overview) =>
      tabPage(h, 'usage/costs', costsViewOf(overview), overview.teamName)
    ),

  carbon: (request, h) =>
    withOverview(request, h, (overview) =>
      overview.carbonBasis.enabled
        ? tabPage(h, 'usage/carbon', carbonViewOf(overview), overview.teamName)
        : errorPage(h, {
            status: statusCodes.notFound,
            heading: 'Carbon is not shown yet',
            message:
              'We are still agreeing how to estimate carbon, so it is not shown yet.',
            back: {
              href: `/usage/${encodeURIComponent(overview.teamSlug)}`,
              text: 'Back to usage'
            }
          })
    ),

  async costsCsv(request, h) {
    const { slug } = request.params

    try {
      const loaded = await loadTeamForView(request, slug)

      if (!loaded.isAdmin) {
        return errorPage(h, {
          status: statusCodes.forbidden,
          heading: 'You cannot export the costs',
          message: 'Only a team admin can export the costs.',
          back: {
            href: `/usage/${encodeURIComponent(slug)}/costs`,
            text: 'Back to costs'
          }
        })
      }

      const overview = await readUsageOverview(request, slug)

      return h
        .response(costsCsvOf(overview))
        .type('text/csv')
        .header(
          'content-disposition',
          `attachment; filename="costs-${overview.month.key}.csv"`
        )
        .header('cache-control', 'no-store')
    } catch (error) {
      const page = refusalPage(request, h, error, request.path)

      if (page) {
        return page
      }

      throw error
    }
  }
}

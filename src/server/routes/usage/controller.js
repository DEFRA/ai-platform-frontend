import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  filterBarOf,
  teamSelectOf
} from '#/server/common/helpers/filter-bar.js'
import {
  getEnvironmentsTeam,
  setEnvironmentsTeam
} from '#/server/common/helpers/session.js'
import { isNotFound, loadTeamForView } from '#/server/routes/teams/team-view.js'
import {
  errorPage,
  teamNotFound
} from '#/server/routes/environments/error-views.js'
import { isUnavailable } from '#/server/routes/environments/environments-api.js'
import { readTeams, readUsageOverview } from './usage-api.js'
import {
  carbonViewOf,
  costsCsvOf,
  costsViewOf,
  overviewViewOf
} from './usage-pages.js'

const USAGE_NOT_AVAILABLE = 'usage-not-available'
const BACK_TO_USAGE = { href: '/usage', text: 'Go to Usage' }
// The tab a team switch stays on, and the address of each.
const TAB_PATHS = { overview: '', costs: '/costs', carbon: '/carbon' }

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

// The team drop-down, for a person with more than one team. It asks `/usage`
// again with the team chosen and the tab they are on, and `/usage` opens that
// team's page. Best effort: without the list the page is as it was, without it.
async function teamFilterBar(request, slug, tab) {
  try {
    const { items } = await readTeams(request)

    return items.length > 1
      ? filterBarOf({
          action: '/usage',
          hidden: [{ name: 'tab', value: tab }],
          selects: [teamSelectOf(items, slug)],
          hint: 'Choosing a team shows its usage. With a keyboard, press Enter after choosing.'
        })
      : null
  } catch (error) {
    request.logger.warn({ err: error }, 'Could not read the teams for Usage')

    return null
  }
}

async function withOverview(request, h, tab, view) {
  const { slug } = request.params

  try {
    const overview = await readUsageOverview(request, slug)

    // The team the person is looking at is the one Usage and Environments open
    // next time.
    setEnvironmentsTeam(request, slug)

    return await view(overview, await teamFilterBar(request, slug, tab))
  } catch (error) {
    const page = refusalPage(request, h, error, request.path)

    if (page) {
      return page
    }

    throw error
  }
}

function tabPage(h, template, view, titleSuffix, filterBar) {
  return h.view(template, {
    pageTitle: `${view.heading} - ${titleSuffix}`,
    filterBar,
    ...view
  })
}

/**
 * The Usage section: one team's Overview, Costs and Carbon, with a drop-down
 * to change team on the same page. Any member of the team reads it; the
 * backend answers for the person's own team only, so another team's address is
 * the same 404 as one that does not exist.
 */
export const usageController = {
  // The Usage menu and the team drop-down both come here: the team chosen
  // (`?team=`), else the one last looked at, else the person's first; and the
  // tab asked for (`?tab=`), else Overview.
  async chooser(request, h) {
    try {
      const { items } = await readTeams(request)

      if (items.length === 0) {
        return h.view('usage/chooser', { pageTitle: 'Usage', heading: 'Usage' })
      }

      const asked = request.query.team ?? getEnvironmentsTeam(request)
      const team = items.find((item) => item.slug === asked) ?? items[0]
      const path = Object.hasOwn(TAB_PATHS, request.query.tab)
        ? TAB_PATHS[request.query.tab]
        : TAB_PATHS.overview

      return h.redirect(`/usage/${encodeURIComponent(team.slug)}${path}`)
    } catch (error) {
      const page = refusalPage(request, h, error, request.path)

      if (page) {
        return page
      }

      throw error
    }
  },

  overview: (request, h) =>
    withOverview(request, h, 'overview', (overview, filterBar) =>
      tabPage(
        h,
        'usage/overview',
        overviewViewOf(overview),
        overview.teamName,
        filterBar
      )
    ),

  costs: (request, h) =>
    withOverview(request, h, 'costs', (overview, filterBar) =>
      tabPage(
        h,
        'usage/costs',
        costsViewOf(overview),
        overview.teamName,
        filterBar
      )
    ),

  carbon: (request, h) =>
    withOverview(request, h, 'carbon', (overview, filterBar) =>
      overview.carbonBasis.enabled
        ? tabPage(
            h,
            'usage/carbon',
            carbonViewOf(overview),
            overview.teamName,
            filterBar
          )
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

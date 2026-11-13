import { statusCodes } from '#/server/common/constants/status-codes.js'
import { teamEnvironmentsUrl } from '#/server/common/helpers/environment-names.js'
import { isNotFound, loadTeamForView } from '#/server/routes/teams/team-view.js'
import { errorPage, teamNotFound } from './error-views.js'
import { isUnavailable } from './environments-api.js'

/**
 * The page that says the backend could not be reached or failed, with a way
 * to try the page again.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {{what: string, back: {href: string, text: string}}} options
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function unavailablePage(h, { what, back }) {
  return errorPage(h, {
    status: statusCodes.serviceUnavailable,
    heading: 'Applications are not available just now',
    message: `We could not ${what} just now. Try again in a moment.`,
    back
  })
}

/**
 * The team of the address and whether the person is an admin of it, or the
 * `page` to show instead: the same 404 for a team that does not exist as for
 * one the person is not a member of, and the unavailable page when the
 * backend failed.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @returns {Promise<{team: object, isAdmin: boolean} | {page: import('@hapi/hapi').ResponseObject}>}
 */
export async function loadTeamContext(request, h) {
  const { slug } = request.params

  try {
    const { team, isAdmin } = await loadTeamForView(request, slug)

    return { team, isAdmin }
  } catch (error) {
    if (isNotFound(error)) {
      return { page: teamNotFound(h) }
    }

    if (isUnavailable(error)) {
      request.logger.warn({ err: error }, 'Could not read a team')

      return {
        page: unavailablePage(h, {
          what: 'read this team',
          back: { href: teamEnvironmentsUrl(slug), text: 'Try again' }
        })
      }
    }

    throw error
  }
}

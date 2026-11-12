import { statusCodes } from '#/server/common/constants/status-codes.js'
import { teamEnvironmentsUrl } from '#/server/common/helpers/environment-names.js'

/**
 * The page for a team that does not exist or is not the person's to see: the
 * same 404 either way, with nothing about the team.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function teamNotFound(h) {
  return h
    .view('error/index', {
      pageTitle: 'Team not found',
      heading: 'Team not found',
      message: 'This team does not exist, or you are not a member.',
      actionHref: '/environments',
      actionText: 'Go to your environments'
    })
    .code(statusCodes.notFound)
}

/**
 * The page for an environment that does not exist or is not available yet.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {string} teamRef - The team's slug or id, for the way back.
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function environmentNotFound(h, teamRef) {
  return h
    .view('error/index', {
      pageTitle: 'Environment not found',
      heading: 'Environment not found',
      message: 'This environment does not exist or is not available yet.',
      actionHref: teamEnvironmentsUrl(teamRef),
      actionText: 'Back to all environments'
    })
    .code(statusCodes.notFound)
}

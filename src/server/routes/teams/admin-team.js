import { statusCodes } from '#/server/common/constants/status-codes.js'
import { requireSignIn } from '#/server/common/helpers/require-sign-in.js'
import {
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamUrl
} from './team-view.js'

// Where a page only admins may use sends the person back to.
const TABS = {
  members: { path: '/members', text: 'Back to the members' },
  details: { path: '/details', text: 'Back to the details' }
}

/**
 * What a member is told when a page is for admins only.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {{name: string, slug: string}} team
 * @param {string} action - What only an admin can do, for example "add people".
 * @param {'members' | 'details'} tab - The tab to offer going back to.
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function adminRequiredView(h, team, action, tab) {
  return h
    .view('error/index', {
      pageTitle: 'Admins only',
      heading: 'Only a team admin can do that',
      message: `Only an admin of ${team.name} can ${action}.`,
      actionHref: `${teamUrl(team)}${TABS[tab].path}`,
      actionText: TABS[tab].text
    })
    .code(statusCodes.forbidden)
}

/**
 * The team for a page only its admins may use, or the page to show instead:
 * a signed-out person is sent to sign in, a team that is not theirs is not
 * found, and a member is told it is for admins.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {string} action - What only an admin can do, for example "add people".
 * @param {'members' | 'details'} tab - The tab to offer going back to.
 * @returns {Promise<{page: object} | {loaded: object}>}
 */
export async function loadAdminTeam(request, h, action, tab) {
  // A failed validation runs before the global sign-in gate, so a signed-out
  // person (with a still-valid CSRF token) is sent to sign in here.
  const signIn = requireSignIn(request, h)

  if (signIn !== h.continue) {
    return { page: signIn }
  }

  let loaded

  try {
    loaded = await loadTeamForView(request, request.params.slug)
  } catch (error) {
    if (isNotFound(error)) {
      return { page: teamNotFoundView(h) }
    }

    throw error
  }

  if (!loaded.isAdmin) {
    return { page: adminRequiredView(h, loaded.team, action, tab) }
  }

  return { loaded }
}

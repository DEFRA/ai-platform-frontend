import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import {
  clearSessionPlatformAdmin,
  getSessionUser
} from '#/server/common/helpers/session.js'

// What every Platform Admin page shares: where the pages are, the sub
// navigation, loading a team, and the pages for what the backend refuses.
// The frontend decides nothing about who may use them: each page asks the
// backend, and the backend answers (plan D2).

export const ADMIN_TEAMS_URL = '/admin/teams'
export const ADMIN_AUDIT_URL = '/admin/audit'

/**
 * Where a team's admin page is.
 * @param {{id: string}} team
 * @returns {string}
 */
export function adminTeamUrl(team) {
  return `${ADMIN_TEAMS_URL}/${encodeURIComponent(team.id)}`
}

/**
 * The Admin area's sub navigation: Teams and Audit log, with the current one
 * marked.
 * @param {'teams'|'audit'} current
 * @returns {Array<{text: string, href: string, current: boolean}>}
 */
export function adminTabs(current) {
  return [
    { key: 'teams', text: 'Teams', href: ADMIN_TEAMS_URL },
    { key: 'audit', text: 'Audit log', href: ADMIN_AUDIT_URL }
  ].map(({ key, text, href }) => ({ text, href, current: key === current }))
}

/**
 * The page for a person the backend says is not a Platform Admin.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function platformAdminRequiredView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Only a Platform Admin can use this page',
      heading: 'Only a Platform Admin can use this page',
      message:
        'You do not have the Platform Admin role. If you need it, ask the AI Platform team.',
      actionHref: '/',
      actionText: 'Go to the home page'
    })
    .code(statusCodes.forbidden)
}

/**
 * The page for a team the backend does not have.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function adminTeamNotFoundView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Team not found',
      heading: 'Team not found',
      message: 'This team does not exist.',
      actionHref: ADMIN_TEAMS_URL,
      actionText: 'Back to the teams'
    })
    .code(statusCodes.notFound)
}

/**
 * The page for a backend that cannot be reached or has failed.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function adminUnavailableView(request, h) {
  return h
    .view('error/index', {
      pageTitle: 'Service unavailable',
      heading: 'We could not load this page',
      message:
        'The platform service did not answer. Try again in a few minutes.',
      actionHref: `${request.path}${request.url.search}`,
      actionText: 'Try again'
    })
    .code(statusCodes.badGateway)
}

/**
 * Whether the backend refused the person's role.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isPlatformAdminRefusal(error) {
  return error instanceof ApiError && error.statusCode === statusCodes.forbidden
}

/**
 * Whether the backend has no such team.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isTeamNotFound(error) {
  return (
    error instanceof ApiError &&
    error.statusCode === statusCodes.notFound &&
    error.code !== 'member-not-found'
  )
}

/**
 * The page for something the backend refused or could not do that the person
 * cannot fix on the page: not a Platform Admin (their Admin link is no longer
 * true, so it goes), no such team, or a backend that is down. Anything else is
 * a fault, so it is thrown.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {unknown} error
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function adminRefusalView(request, h, error) {
  if (isPlatformAdminRefusal(error)) {
    clearSessionPlatformAdmin(request)

    return platformAdminRequiredView(h)
  }

  if (isTeamNotFound(error)) {
    return adminTeamNotFoundView(h)
  }

  if (
    error instanceof ApiError &&
    error.statusCode >= statusCodes.internalServerError
  ) {
    return adminUnavailableView(request, h)
  }

  throw error
}

/**
 * A team's members for the page: each says whether it is the signed-in
 * person, and a removed member (kept for audit only) is left out. A Platform
 * Admin sees every name and address.
 * @param {import('@hapi/hapi').Request} request
 * @param {object[]} members
 * @returns {object[]}
 */
function viewMembers(request, members) {
  const sessionUser = getSessionUser(request)

  return members
    .filter((member) => member.status !== 'removed')
    .map((member) => ({ ...member, isYou: member.userId === sessionUser?.id }))
}

/**
 * Reads a team for a Platform Admin: the team with its status and the
 * environments it is in, and its members. The read is the check: the backend
 * refuses anyone who is not a Platform Admin and records the refusal.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamId
 * @returns {Promise<{team: object, members: object[]}>}
 */
export async function loadAdminTeam(request, teamId) {
  const { team, members } = await apiClient(request).get(
    `/v1/admin/teams/${encodeURIComponent(teamId)}`
  )

  return { team, members: viewMembers(request, members) }
}

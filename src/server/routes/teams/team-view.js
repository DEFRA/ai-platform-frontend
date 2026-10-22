import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'

/**
 * Where a team's pages live: its slug, never its id (D10).
 * @param {{slug: string}} team
 * @returns {string}
 */
export function teamUrl(team) {
  return `/teams/${encodeURIComponent(team.slug)}`
}

/**
 * The team's tabs, with the current one marked. Everyone sees all three;
 * only admins see change actions on them.
 * @param {{slug: string}} team
 * @param {'models' | 'members' | 'details'} current
 * @returns {Array<{text: string, href: string, current: boolean}>}
 */
export function teamTabs(team, current) {
  const base = teamUrl(team)

  return [
    { key: 'models', text: 'Models', href: base },
    { key: 'members', text: 'Members', href: `${base}/members` },
    { key: 'details', text: 'Details', href: `${base}/details` }
  ].map(({ key, text, href }) => ({ text, href, current: key === current }))
}

/**
 * The page for a team that does not exist or is not the person's to see.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function teamNotFoundView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Team not found',
      heading: 'Team not found',
      message: 'This team does not exist, or you are not a member.',
      actionHref: '/teams',
      actionText: 'Go to your teams'
    })
    .code(statusCodes.notFound)
}

/**
 * Whether the backend refused the caller for lack of permission.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isForbidden(error) {
  return error instanceof ApiError && error.statusCode === statusCodes.forbidden
}

/**
 * Whether the backend has no such record.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNotFound(error) {
  return error instanceof ApiError && error.statusCode === statusCodes.notFound
}

// Only an admin needs to see a colleague's full address (to manage invites);
// everyone else gets a masked form so the page isn't a team-wide email list.
function maskEmail(email) {
  const [localPart, domain] = email.split('@')

  if (!domain) {
    return 'Hidden'
  }

  return `${localPart.slice(0, 1)}${'*'.repeat(Math.max(localPart.length - 1, 1))}@${domain}`
}

/**
 * The team with its members shaped for the signed-in person's view: each
 * says whether it is them, and colleagues' addresses are masked unless they
 * are an admin. Whether the team's last admin may be changed is the
 * backend's rule, answered when a change is tried.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef - The team's slug (or id).
 * @returns {Promise<{team: object, members: object[], isAdmin: boolean, environments: Array<{environment: string, limits: object}>}>}
 */
export async function loadTeamForView(request, teamRef) {
  const sessionUser = getSessionUser(request)
  const result = await apiClient(request).get(
    `/v1/teams/${encodeURIComponent(teamRef)}`,
    { userId: sessionUser.id }
  )

  const isAdmin = result.members.some(
    (member) =>
      member.userId === sessionUser.id &&
      member.role === 'admin' &&
      member.status === 'active'
  )

  const members = result.members
    // Removed members are kept in the backend for audit purposes only.
    .filter((member) => member.status !== 'removed')
    .map((member) => {
      const isYou = member.userId === sessionUser.id

      return {
        ...member,
        isYou,
        email:
          member.email && !isAdmin && !isYou
            ? maskEmail(member.email)
            : member.email
      }
    })

  return { ...result, members, isAdmin }
}

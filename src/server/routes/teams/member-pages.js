import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from '#/server/common/helpers/api-client.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  adminRequiredView as adminRequired,
  loadAdminTeam as loadAdmin
} from './admin-team.js'
import { isForbidden, isNotFound, teamUrl } from './team-view.js'

// What the member pages share: the Members tab's address, the pages for a
// person who is not an admin or a member who is not there, and the errors a
// page shows.

export function membersUrl(team) {
  return `${teamUrl(team)}/members`
}

export function adminRequiredView(h, team, action) {
  return adminRequired(h, team, action, 'members')
}

export function memberNotFoundView(h, team, backUrl = membersUrl(team)) {
  return h
    .view('error/index', {
      pageTitle: 'Member not found',
      heading: 'Member not found',
      message: `This person is not a member of ${team.name}, or has already been removed.`,
      actionHref: backUrl,
      actionText: 'Back to the members'
    })
    .code(statusCodes.notFound)
}

export function loadAdminTeam(request, h, action) {
  return loadAdmin(request, h, action, 'members')
}

// A change the backend refused for a reason the person cannot fix on the
// page (they are not an admin, or it is not there): the page to show instead.
// Anything else is a fault, so it is thrown.
export function refusalView(h, team, error, action) {
  if (!(error instanceof ApiError)) {
    throw error
  }

  if (isForbidden(error)) {
    return adminRequiredView(h, team, action)
  }

  if (isNotFound(error)) {
    return memberNotFoundView(h, team)
  }

  throw error
}

export function errorOn(field, message) {
  return {
    errorSummary: [{ text: message, href: `#${field}` }],
    fieldErrors: { [field]: { text: message } }
  }
}

export function noErrors() {
  return { errorSummary: null, fieldErrors: {} }
}

/**
 * The page that asks whether to remove a person from a team (screen 15).
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {object} page
 * @param {{name: string}} page.team
 * @param {{displayName: string}} page.member
 * @param {string} page.backUrl - Where Back goes.
 * @param {string} page.cancelUrl - Where Cancel goes.
 * @param {string} page.warningText - What removing them leaves undone.
 * @param {{text: string, href: string}} [page.warningLink] - A link under the warning.
 * @param {{errorSummary: object[] | null, fieldErrors: object}} [page.errors]
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function removeMemberView(
  h,
  {
    team,
    member,
    backUrl,
    cancelUrl,
    warningText,
    warningLink,
    errors = noErrors()
  }
) {
  const heading = `Remove ${member.displayName} from ${team.name}?`

  return h.view('teams/remove-member', {
    pageTitle: `${errors.errorSummary ? 'Error: ' : ''}${heading}`,
    heading,
    team,
    backUrl,
    cancelUrl,
    warningText,
    warningLink,
    buttonText: `Remove ${member.displayName}`,
    ...errors
  })
}

// What the page says when the backend refused a removal that would leave the
// team with no admin.
export function lastAdminMessage(member, change) {
  return member.isYou
    ? `You are the only admin. Add another admin before you ${change.you}.`
    : `A team must keep at least one admin. Add another admin before you ${change.other(member.displayName)}.`
}

export const REMOVE_CHANGE = {
  you: 'remove yourself from this team',
  other: (name) => `remove ${name} from this team`
}

export function joiErrors(error) {
  return {
    errorSummary: buildErrorSummary(error),
    fieldErrors: buildFieldErrors(error)
  }
}

/**
 * Where the add-member pages run, so a team's own pages and a Platform
 * Admin's share one controller.
 * @typedef {object} MemberScope
 * @property {(request: object, h: object, action: string) => Promise<{page: object} | {loaded: {team: object}}>} load
 *   The team for the page, or the page to show instead (a refusal).
 * @property {(team: object) => string} ref - What names the team to the backend and to the add keys.
 * @property {((teamRef: string) => string) | undefined} pathOf
 *   The team's address on the backend; the team's own pages when undefined.
 * @property {(team: object) => string} listUrl - The members, where Back and a done add go.
 * @property {(team: object) => string} searchUrl - Where the page's script searches the directory.
 * @property {(request: object, h: object, team: object, error: unknown, action: string) => object} refusalView
 *   The page for a refusal the person cannot fix on the page, or it throws the error.
 */

/** A team's own pages, for its admins. @type {MemberScope} */
export const teamMemberScope = {
  load: loadAdminTeam,
  ref: (team) => team.slug,
  pathOf: undefined,
  listUrl: membersUrl,
  searchUrl: (team) => `${membersUrl(team)}/add/people`,
  refusalView: (_request, h, team, error, action) =>
    refusalView(h, team, error, action)
}

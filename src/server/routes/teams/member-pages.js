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

export function memberNotFoundView(h, team) {
  return h
    .view('error/index', {
      pageTitle: 'Member not found',
      heading: 'Member not found',
      message: `This person is not a member of ${team.name}, or has already been removed.`,
      actionHref: membersUrl(team),
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

export function joiErrors(error) {
  return {
    errorSummary: buildErrorSummary(error),
    fieldErrors: buildFieldErrors(error)
  }
}

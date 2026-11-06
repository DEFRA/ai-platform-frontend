import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'

// What the directory search accepts, as the backend does.
export const MIN_SEARCH_LENGTH = 2
export const MAX_SEARCH_LENGTH = 100

// What the backend can refuse a person for, by its `code`, with the status
// the page answers with and what the admin is told.
const PROBLEMS = {
  'member-exists': {
    statusCode: statusCodes.conflict,
    text: 'This person is already a member of this team'
  },
  'person-not-eligible': {
    statusCode: statusCodes.unprocessableEntity,
    text: 'This person cannot be added to a team. Search again and choose someone else'
  },
  'directory-unavailable': {
    statusCode: statusCodes.serviceUnavailable,
    text: 'We could not reach the directory. Try again in a few minutes'
  },
  // The backend saw this key with another person or role: not an add that
  // exists already, so not "already a member".
  'idempotency-key-reused': {
    statusCode: statusCodes.conflict,
    text: 'We could not add this person. Check the person and role, then select Add again'
  }
}

function teamPath(teamSlug) {
  return `/v1/teams/${encodeURIComponent(teamSlug)}`
}

/**
 * Searches the directory for people an admin of the team could add: eligible
 * people who are not already members.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamSlug
 * @param {string} search - 2 to 100 characters of a name or email address.
 * @returns {Promise<Array<{oid: string, displayName: string, email: string}>>}
 */
export async function searchTeamPeople(request, teamSlug, search) {
  const { items } = await apiClient(request).post(
    `${teamPath(teamSlug)}/people/search`,
    { search }
  )

  return items
}

/**
 * Adds a person from the directory to the team, by their `oid`.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamSlug
 * @param {{oid: string, role: 'admin' | 'user'}} person
 * @param {string} idempotencyKey - The same key for the same add, so a retry adds once.
 * @returns {Promise<{displayName: string}>}
 */
export async function addTeamMember(
  request,
  teamSlug,
  { oid, role },
  idempotencyKey
) {
  const { member } = await apiClient(request).post(
    `${teamPath(teamSlug)}/members`,
    { oid, role },
    { idempotencyKey }
  )

  return member
}

/**
 * What a refusal the admin can act on means for the page, or undefined when
 * the error is not one of those.
 * @param {unknown} error
 * @returns {{statusCode: number, text: string} | undefined}
 */
export function personProblem(error) {
  return error instanceof ApiError && Object.hasOwn(PROBLEMS, error.code)
    ? PROBLEMS[error.code]
    : undefined
}

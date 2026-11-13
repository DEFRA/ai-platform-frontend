import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'

// The backend's team routes for the Environments and deployments section. Each
// call carries the team (its slug or id) in its path, and the backend answers
// for that team's members only: a person who is not a member gets 404, with
// nothing about the team.

function teamPath(teamRef) {
  return `/v1/teams/${encodeURIComponent(teamRef)}`
}

/**
 * Every environment this instance offers, for one team, with its models,
 * limits, applications and latest change.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef - The team's slug or id.
 * @returns {Promise<{team: {id: string, slug: string, name: string}, environments: object[]}>}
 */
export function readTeamEnvironments(request, teamRef) {
  return apiClient(request).get(`${teamPath(teamRef)}/environments`)
}

/**
 * One environment of a team in full, with the bounds its limits may be
 * changed within and the limits a change in progress will set.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef
 * @param {string} environment - The environment's registry code.
 * @returns {Promise<object>}
 */
export function readTeamEnvironment(request, teamRef, environment) {
  return apiClient(request).get(
    `${teamPath(teamRef)}/environments/${encodeURIComponent(environment)}`
  )
}

/**
 * A team's changes to its files, newest first.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef
 * @param {{environment?: string, status?: 'open' | 'recent', limit?: number}} filters
 * @returns {Promise<{items: object[]}>}
 */
export function readTeamOperations(request, teamRef, filters) {
  const query = new URLSearchParams(filters).toString()

  return apiClient(request).get(`${teamPath(teamRef)}/operations?${query}`)
}

/**
 * Asks for one environment's limits to be changed: one operation on the
 * team's file. The key makes asking again with the same answers the same
 * request.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef
 * @param {string} environment
 * @param {{tokensPerMinute: number, requestsPerMinute: number}} limits
 * @param {string} idempotencyKey
 * @returns {Promise<{operation: object}>}
 */
export function putTeamLimits(
  request,
  teamRef,
  environment,
  limits,
  idempotencyKey
) {
  return apiClient(request).put(
    `${teamPath(teamRef)}/environments/${encodeURIComponent(environment)}/limits`,
    limits,
    { idempotencyKey }
  )
}

/**
 * Whether the backend could not be reached or failed, so a page says it is
 * unavailable just now and the person can try again.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isUnavailable(error) {
  return (
    error instanceof ApiError &&
    error.statusCode >= statusCodes.internalServerError
  )
}

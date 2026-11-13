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
 * One change to a team's files, as the backend gives it.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef
 * @param {string} operationId
 * @returns {Promise<object>}
 */
export function readTeamOperation(request, teamRef, operationId) {
  return apiClient(request).get(
    `${teamPath(teamRef)}/operations/${encodeURIComponent(operationId)}`
  )
}

/**
 * A dry run of federating an application: for each environment asked for, null
 * or the code it would be refused with. Changes nothing.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef
 * @param {object} application - `{host, service | principalId, name, environments}`.
 * @returns {Promise<{environments: Array<{environment: string, code: string | null}>}>}
 */
export function checkTeamFederation(request, teamRef, application) {
  return apiClient(request).post(
    `${teamPath(teamRef)}/federations/check`,
    application
  )
}

/**
 * Federates an application in each environment asked for: one operation per
 * environment. The key makes asking again with the same answers the same
 * request. Nothing is queued when any environment is refused.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef
 * @param {object} application
 * @param {string} idempotencyKey
 * @returns {Promise<{federations: Array<{environment: string, id: string, status: string, operationId: string}>}>}
 */
export function postTeamFederations(
  request,
  teamRef,
  application,
  idempotencyKey
) {
  return apiClient(request).post(
    `${teamPath(teamRef)}/federations`,
    application,
    { idempotencyKey }
  )
}

function applicationPath(teamRef, environment, federationId) {
  return `${teamPath(teamRef)}/environments/${encodeURIComponent(environment)}/federations/${encodeURIComponent(federationId)}`
}

/**
 * Changes one environment's application (an admin): a CDP application's
 * service, or an Azure one's principal ID and name.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef
 * @param {{environment: string, federationId: string}} target
 * @param {{service?: string, principalId?: string, name?: string}} change
 * @param {string} idempotencyKey
 * @returns {Promise<{federation: object, operationId: string}>}
 */
export function patchTeamFederation(
  request,
  teamRef,
  { environment, federationId },
  change,
  idempotencyKey
) {
  return apiClient(request).patch(
    applicationPath(teamRef, environment, federationId),
    change,
    { idempotencyKey }
  )
}

/**
 * Removes one environment's application (an admin).
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef
 * @param {{environment: string, federationId: string}} target
 * @returns {Promise<{federation: object}>}
 */
export function deleteTeamFederation(
  request,
  teamRef,
  { environment, federationId }
) {
  return apiClient(request).del(
    applicationPath(teamRef, environment, federationId)
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

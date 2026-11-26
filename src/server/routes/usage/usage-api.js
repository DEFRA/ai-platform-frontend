import { apiClient } from '#/server/common/helpers/api-client.js'

/**
 * A team's usage across every environment, six months and this month: what
 * its models were asked, what that came to, and what needs attention. Any
 * member reads it; the backend answers for the person's own team only.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamRef - The team's slug or id.
 * @returns {Promise<object>}
 */
export function readUsageOverview(request, teamRef) {
  return apiClient(request).get(
    `/v1/teams/${encodeURIComponent(teamRef)}/usage`
  )
}

/**
 * The teams the signed-in person belongs to, for the team drop-down.
 * @param {import('@hapi/hapi').Request} request
 * @returns {Promise<{items: Array<{slug: string, name: string}>}>}
 */
export function readTeams(request) {
  return apiClient(request).get('/v1/teams')
}

/**
 * This month's usage for each team the signed-in person belongs to.
 * @param {import('@hapi/hapi').Request} request
 * @returns {Promise<{items: object[]}>}
 */
export function readUsageSummary(request) {
  return apiClient(request).get('/v1/users/me/usage')
}

/**
 * A personal key's usage over the last `days` days, and when it ends.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} credentialId
 * @param {number} days - 7, 30 or 90.
 * @returns {Promise<object>}
 */
export function readKeyUsage(request, credentialId, days) {
  return apiClient(request).get(
    `/v1/credentials/${encodeURIComponent(credentialId)}/usage?days=${days}`
  )
}

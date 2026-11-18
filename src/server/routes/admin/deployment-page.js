import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import {
  ADMIN_DEPLOYMENTS_URL,
  ADMIN_TEAMS_URL,
  adminDeploymentUrl,
  adminRefusalView
} from './admin-page.js'
import { deploymentsUrl } from './deployments-query.js'

// What every page of one team's deployment shares: loading it, its
// breadcrumbs, the page for a deployment the backend does not have, and the
// refusals. Who may use a page is the backend's decision, asked on every
// request (plan D2).

export const DEPLOYMENTS_API = '/v1/admin/team-deployments'

/**
 * The breadcrumbs of a page of a team's deployment: down to the team, and
 * when the page is one of the actions on it, the team links to the deployment
 * and the page is the last.
 * @param {{team: {id: string, name: string}, environment: string}} deployment
 * @param {string} [current] - The action page's name.
 * @returns {Array<{text: string, href?: string}>}
 */
export function deploymentBreadcrumbs(deployment, current) {
  const { team, environment } = deployment

  return [
    { text: 'Home', href: '/' },
    { text: 'Admin', href: ADMIN_TEAMS_URL },
    { text: 'Deployments', href: ADMIN_DEPLOYMENTS_URL },
    {
      text: environmentName(environment),
      href: deploymentsUrl({ environment })
    },
    current
      ? { text: team.name, href: adminDeploymentUrl(team.id, environment) }
      : { text: team.name },
    ...(current ? [{ text: current }] : [])
  ]
}

/**
 * Environment codes as the names a person reads, "Development", "Development
 * and Test", "Development, Test and Production".
 * @param {string[]} environments
 * @returns {string}
 */
export function environmentList(environments) {
  const names = environments.map(environmentName)

  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * Reads a team's deployment in one environment for a Platform Admin. The read
 * is the check: the backend refuses anyone who is not a Platform Admin and
 * records the refusal.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamId
 * @param {string} environment - The environment code.
 * @returns {Promise<object>}
 */
export function loadDeployment(request, teamId, environment) {
  return apiClient(request).get(
    `${DEPLOYMENTS_API}/${encodeURIComponent(teamId)}/${encodeURIComponent(environment)}`
  )
}

/**
 * The page for a team or environment the backend has no deployment for.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function deploymentNotFoundView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Deployment not found',
      heading: 'Deployment not found',
      message: 'This team has no deployment in this environment.',
      actionHref: ADMIN_DEPLOYMENTS_URL,
      actionText: 'Back to the deployments'
    })
    .code(statusCodes.notFound)
}

/**
 * Whether the backend has no such deployment.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDeploymentNotFound(error) {
  return error instanceof ApiError && error.statusCode === statusCodes.notFound
}

/**
 * The page for something the backend refused or could not do that the person
 * cannot fix on the page: no such deployment, or what the Admin area already
 * says (not a Platform Admin, a backend that is down). Anything else is a
 * fault, so it is thrown.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {unknown} error
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function deploymentRefusalView(request, h, error) {
  return isDeploymentNotFound(error)
    ? deploymentNotFoundView(h)
    : adminRefusalView(request, h, error)
}

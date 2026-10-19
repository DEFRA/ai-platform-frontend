import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import {
  deploymentStatusText,
  deploymentTagClass,
  isDeploymentInProgress
} from '#/server/common/helpers/deployment-status.js'

export const TEAM_VIEW = 'teams/team'

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
 * The team with its members shaped for the signed-in person's view.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} id
 * @returns {Promise<{team: object, members: object[], isAdmin: boolean}>}
 */
export async function loadTeamForView(request, id) {
  const sessionUser = getSessionUser(request)
  const result = await apiClient(request).get(`/v1/teams/${id}`, {
    userId: sessionUser.id
  })

  const isAdmin = result.members.some(
    (member) =>
      member.userId === sessionUser.id &&
      member.role === 'admin' &&
      member.status === 'active'
  )

  const activeAdminCount = result.members.filter(
    (member) => member.role === 'admin' && member.status === 'active'
  ).length

  const members = result.members
    // Removed members are kept in the backend for audit purposes only.
    .filter((member) => member.status !== 'removed')
    .map((member) => ({
      ...member,
      email:
        member.email && !isAdmin && member.userId !== sessionUser.id
          ? maskEmail(member.email)
          : member.email,
      // The team's last admin can be neither removed nor demoted; promote
      // someone else first.
      canRemove: isAdmin && !(member.role === 'admin' && activeAdminCount <= 1),
      canChangeRole:
        isAdmin && !(member.role === 'admin' && activeAdminCount <= 1),
      nextRole: member.role === 'admin' ? 'user' : 'admin'
    }))

  return { ...result, members, isAdmin }
}

/**
 * The team's model deployments, as rows for the team page. Supplementary to
 * the team itself: a failure to list them must not take the page down, but
 * is reported as such rather than shown as a team with no models.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} id
 * @param {boolean} isAdmin
 * @returns {Promise<{models: object[], modelsUnavailable: boolean}>}
 */
export async function loadTeamModels(request, id, isAdmin) {
  const sessionUser = getSessionUser(request)
  const [deployments, catalogue] = await Promise.allSettled([
    apiClient(request).get(`/v1/teams/${id}/deployments`, {
      userId: sessionUser.id
    }),
    apiClient(request).get('/v1/models')
  ])

  if (deployments.status === 'rejected') {
    request.logger.warn(
      { err: deployments.reason },
      'Could not load the team models for the team page'
    )
    return { models: [], modelsUnavailable: true }
  }

  const modelNames = Object.fromEntries(
    (catalogue.value?.items ?? []).map((model) => [
      model.slug,
      model.displayName
    ])
  )

  const models = (deployments.value?.items ?? []).map((deployment) => ({
    _id: deployment._id,
    modelSlug: deployment.modelSlug,
    modelDisplayName: modelNames[deployment.modelSlug] ?? deployment.modelSlug,
    environment: deployment.environment,
    status: deployment.status,
    statusText: deploymentStatusText(deployment.status),
    tagClass: deploymentTagClass(deployment.status),
    failureReason: deployment.failureReason ?? null,
    // Only an admin removes a model, and only one that is in place.
    canRemove: isAdmin && deployment.status === 'active',
    removeUrl: `/teams/${id}/models/${deployment._id}/remove`,
    requestUrl: `/connect/team/request/${id}/${deployment._id}`
  }))

  return { models, modelsUnavailable: false }
}

/**
 * What every render of the team page needs. A model still changing is
 * reported with a link to refresh, never by reloading the page under the
 * person's forms.
 * @param {{team: object, members: object[], isAdmin: boolean}} result
 * @param {{models: object[], modelsUnavailable: boolean}} listing
 * @param {object} [extras]
 * @returns {object}
 */
export function teamPageContext(result, listing, extras) {
  return {
    pageTitle: result.team.name,
    heading: result.team.name,
    team: result.team,
    members: result.members,
    isAdmin: result.isAdmin,
    models: listing.models,
    modelsUnavailable: listing.modelsUnavailable,
    modelsChanging: listing.models.some((model) =>
      isDeploymentInProgress(model.status)
    ),
    serviceCodeValue: result.team.serviceCode ?? '',
    notification: null,
    errorSummary: null,
    fieldErrors: {},
    ...extras
  }
}

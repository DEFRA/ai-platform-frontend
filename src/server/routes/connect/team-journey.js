import {
  clearPendingAccess,
  getPendingAccess,
  getSessionUser
} from '#/server/common/helpers/session.js'

// The most models one request can ask for: a team's file holds 20 deployments.
export const MAX_MODELS_PER_REQUEST = 20

/**
 * The team journey the signed-in person is part of, or undefined. A journey
 * is stamped with its person when they choose a team; one stamped for
 * anyone else is dropped, so what one person left in a session never reaches
 * the next person to use it.
 * @param {import('@hapi/hapi').Request} request
 * @returns {object | undefined}
 */
export function teamJourneyOf(request) {
  const pendingAccess = getPendingAccess(request)

  if (
    pendingAccess?.userId &&
    pendingAccess.userId !== getSessionUser(request)?.id
  ) {
    clearPendingAccess(request)

    return undefined
  }

  return pendingAccess
}

/**
 * The team journey needs a chosen team and at least one chosen model.
 * Without the teamId a shared-flow session would fall through to
 * /v1/teams/undefined/....
 * @param {object | undefined} pendingAccess
 * @returns {boolean}
 */
export function hasTeamJourneyState(pendingAccess) {
  return Boolean(
    pendingAccess?.modelSlugs?.length &&
    pendingAccess.teamId &&
    pendingAccess.accessType === 'team'
  )
}

/**
 * A journey ready to confirm: it has its answers, and the key that makes
 * confirming them idempotent.
 * @param {object | undefined} pendingAccess
 * @returns {boolean}
 */
export function hasCompletedTeamJourney(pendingAccess) {
  return Boolean(
    hasTeamJourneyState(pendingAccess) &&
    pendingAccess.environment &&
    pendingAccess.requestKey
  )
}

/**
 * The models to tick when the model step opens: the ones already chosen in
 * this journey, else the one the person came from on a model's page.
 * @param {object} pendingAccess
 * @returns {string[]}
 */
export function preselectedModelSlugs(pendingAccess) {
  if (pendingAccess.modelSlugs?.length) {
    return pendingAccess.modelSlugs
  }

  return pendingAccess.modelSlug ? [pendingAccess.modelSlug] : []
}

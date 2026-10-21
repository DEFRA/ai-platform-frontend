import Joi from 'joi'

import {
  clearPendingAccess,
  getPendingAccess,
  getSessionUser
} from '#/server/common/helpers/session.js'

// The most models one request can ask for: a team's file holds 20 deployments.
export const MAX_MODELS_PER_REQUEST = 20

// "Change" on the check page opens a step with `?change=check`; the step's
// form posts back to that address, so it returns to the check page.
const CHANGE_FROM_CHECK = 'check'

export const changeQuerySchema = Joi.object({
  change: Joi.string().valid(CHANGE_FROM_CHECK).optional()
}).unknown(true)

/**
 * Whether the step was opened from "Change" on the check page.
 * @param {import('@hapi/hapi').Request} request
 * @returns {boolean}
 */
export function isChange(request) {
  return request.query.change === CHANGE_FROM_CHECK
}

/**
 * The address of a journey step, marked as a change when it should return to
 * the check page.
 * @param {string} path
 * @param {boolean} [change]
 * @returns {string}
 */
export function stepUrl(path, change = false) {
  return change ? `${path}?change=${CHANGE_FROM_CHECK}` : path
}

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
    pendingAccess.teamSlug &&
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

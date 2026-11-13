import { randomUUID } from 'node:crypto'

import { derivedIdempotencyKey } from '#/server/common/helpers/idempotency-key.js'

// A disable or revoke is one call for each environment, each with an
// `Idempotency-Key` the backend takes as a version 4 UUID. The reason page
// carries a key it was issued with; the key sent for an environment is made
// from the session, the team, the action, the environment, the page's key and
// the reason (an HMAC, in the shared `idempotency-key` helper), so a retry of
// the same form with the same reason sends the same key and the backend does
// it once, another reason from the same page has a key of its own (the
// backend refuses the same key for a different request), and nothing is kept
// in the session.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A new key for a page that is shown.
 * @returns {string}
 */
export function issueFormKey() {
  return randomUUID()
}

/**
 * The key a form came back with, when it is a UUID, and otherwise a new one.
 * @param {unknown} offered
 * @returns {string}
 */
export function carryFormKey(offered) {
  return typeof offered === 'string' && UUID_PATTERN.test(offered)
    ? offered.toLowerCase()
    : issueFormKey()
}

/**
 * The `Idempotency-Key` for one environment of a disable or revoke.
 * @param {import('@hapi/hapi').Request} request
 * @param {object} operation
 * @param {string} operation.action - disable or revoke.
 * @param {string} operation.teamId
 * @param {string} operation.environment
 * @param {string} operation.formKey - The key the page was issued with.
 * @param {string} operation.reason - The reason, as sent.
 * @returns {string}
 */
export function credentialKey(
  request,
  { action, teamId, environment, formKey, reason }
) {
  return derivedIdempotencyKey([
    'admin-credentials',
    request.yar.id,
    action,
    teamId,
    environment,
    formKey,
    reason
  ])
}

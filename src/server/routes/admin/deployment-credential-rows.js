import {
  federationKind,
  federationTag
} from '#/server/routes/environments/federation-view.js'
import { adminDeploymentUrl, adminOperationUrl } from './admin-page.js'
import { credentialTag } from './deployment-labels.js'

// What the deployment page lists of the team's credentials in an environment,
// from the backend's read: the client secrets (`clientSecrets`, as the team's
// own page reads them) and the federated applications (`federations`). A
// secret is named only by the end of its key, never by a value; only an
// active one can be revoked.

const EXPIRED_TAG = { text: 'Expired', classes: 'govuk-tag--grey' }
const ACTIVE = 'active'

/** The states of an application an admin can remove: not one being set up or removed. */
export const REMOVABLE_STATUSES = new Set(['ready', 'failed'])

function secretTag(status) {
  return status === 'expired' ? EXPIRED_TAG : credentialTag(status)
}

/**
 * The client secrets table, or null when the team holds none to list.
 * @param {{team: {id: string}, environment: string, clientSecrets?: {used: number, limit: number, items?: object[]}}} deployment
 * @returns {{countText: string, rows: object[]} | null}
 */
export function clientSecretsSection({ team, environment, clientSecrets }) {
  const items = clientSecrets?.items ?? []

  if (items.length === 0) {
    return null
  }

  const base = adminDeploymentUrl(team.id, environment)

  return {
    countText: `${clientSecrets.used} of ${clientSecrets.limit} places used`,
    rows: items.map(({ id, keyHint, expiresAt, status }) => ({
      id,
      hint: `Ending ${keyHint}`,
      expiresAt: expiresAt ?? null,
      status: secretTag(status),
      revokeUrl:
        status === ACTIVE
          ? `${base}/credentials/${encodeURIComponent(id)}/revoke`
          : null
    }))
  }
}

/**
 * The federated credentials table rows, none when the team has none. Retry is
 * offered when the backend says the application's change can be retried;
 * Reconcile also beside one that failed.
 * @param {{team: {id: string}, environment: string, federations?: object[]}} deployment
 * @returns {object[]}
 */
export function federationRows({ team, environment, federations = [] }) {
  const base = adminDeploymentUrl(team.id, environment)

  return federations.map(
    ({ id, name, host, status, failureReason, operationId, retryable }) => {
      const { text, tagClass } = federationTag(status)
      const url = (action) =>
        operationId
          ? adminOperationUrl(team.id, environment, operationId, action)
          : null

      return {
        id,
        name,
        kind: federationKind(host),
        status: { text, classes: tagClass },
        reason: status === 'failed' ? (failureReason ?? null) : null,
        removeUrl: REMOVABLE_STATUSES.has(status)
          ? `${base}/federations/${encodeURIComponent(id)}/remove`
          : null,
        reconcileUrl:
          retryable || status === 'failed' ? url('reconcile') : null,
        retryUrl: retryable ? url('retry') : null
      }
    }
  )
}

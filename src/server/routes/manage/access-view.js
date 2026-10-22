import { differenceInCalendarDays } from 'date-fns'

import { formatDate } from '#/config/nunjucks/filters/format-date.js'

// How the Your access page shapes what a person holds: the keys they can use
// on their own. A team's models and client secret are on the team's page.

const TEAM_TIER = 'team'

// A credential that never finished issuing (still 'pending', or 'failed'
// after a retry was exhausted/reconciled) was never a usable key, and a
// revoked one is gone - nothing to view/renew/revoke. Surfacing them would
// show a permanent dead-end row.
const HIDDEN_CREDENTIAL_STATUSES = ['pending', 'failed', 'revoked']

function renewedHint(renewalCount, { atCap }) {
  if (!renewalCount) {
    return null
  }

  const times = renewalCount === 1 ? 'once' : `${renewalCount} times`

  return atCap
    ? `Renewed ${times}, so it cannot be renewed again`
    : `Renewed ${times}`
}

function daysFromNow(expiresAt) {
  return Math.max(differenceInCalendarDays(new Date(expiresAt), new Date()), 0)
}

function isExpired(credential) {
  return (
    credential.status === 'expired' ||
    (Boolean(credential.expiresAt) &&
      new Date(credential.expiresAt) < new Date())
  )
}

function expiryText(credential, expired) {
  if (!credential.expiresAt) {
    return null
  }

  const date = formatDate(credential.expiresAt)

  if (expired) {
    return `Expired on ${date}`
  }

  const days = daysFromNow(credential.expiresAt)

  if (days === 0) {
    return `${date}, today`
  }

  return `${date}, in ${days} ${days === 1 ? 'day' : 'days'}`
}

function keyRow(credential, modelNames) {
  const expired = isExpired(credential)
  const canRenew = credential.renewalsRemaining > 0
  const modelSlug = credential.modelSlug

  return {
    ...credential,
    modelDisplayName: modelNames[modelSlug] ?? modelSlug,
    expiresText: expiryText(credential, expired),
    renewedHint: renewedHint(credential.renewalCount, {
      atCap: expired && !canRenew
    }),
    expired,
    // An expired key that cannot be renewed has nothing to view, renew or
    // revoke: the person gets a new one.
    getNewKeyUrl:
      expired && !canRenew
        ? `/connect/shared/start?modelSlug=${encodeURIComponent(modelSlug)}`
        : null
  }
}

/**
 * The "Your access" rows: the person's own research keys, in the order the
 * API gives them. A team's client secret is on the team's page, not here.
 * @param {object[]} credentials
 * @param {Record<string, string>} modelNames
 * @returns {object[]}
 */
export function buildKeyRows(credentials, modelNames) {
  return credentials
    .filter(
      (credential) =>
        credential.tier !== TEAM_TIER &&
        !HIDDEN_CREDENTIAL_STATUSES.includes(credential.status)
    )
    .map((credential) => keyRow(credential, modelNames))
}

/**
 * GOV.UK's notification banner macro only has a distinct "success" style;
 * anything else renders its default (informational/error) style.
 * @param {{type?: string, message: string} | undefined} notification
 * @returns {object | null}
 */
export function notificationBannerParams(notification) {
  if (!notification) {
    return null
  }

  return {
    text: notification.message,
    ...(notification.type === 'success' ? { type: 'success' } : {})
  }
}

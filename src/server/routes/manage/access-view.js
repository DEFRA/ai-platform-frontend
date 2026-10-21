import { differenceInCalendarDays } from 'date-fns'

import {
  DEPLOYMENT_FAILURE_STATUSES,
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS,
  deploymentStatusText,
  deploymentTagClass,
  isDeploymentInProgress
} from '#/server/common/helpers/deployment-status.js'
import {
  credentialEnvironmentName,
  environmentName
} from '#/server/common/helpers/environment-names.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { formatLabel } from '#/config/nunjucks/filters/format-label.js'

// How the Your access page shapes what a person holds: the keys they can use
// on their own, and their teams' models with where each has got to.

const TAG_CLASS_BY_STATUS = {
  active: 'govuk-tag--green',
  revoked: 'govuk-tag--red'
}

const TEAM_TIER = 'team'

// Research keys carry a fixed, meaningful expiry - show a countdown instead
// of a static "Active" tag so people notice one is about to run out.
const RESEARCH_EXPIRY_WARNING_DAYS = 3

// A credential that never finished issuing (still 'pending', or 'failed'
// after a retry was exhausted/reconciled) was never a usable key - nothing
// to view/renew/revoke. Surfacing it would show, per failed attempt, a
// permanent dead-end row (the connect journey already told the requester
// about the failure inline when it happened).
const UNISSUED_CREDENTIAL_STATUSES = ['pending', 'failed']

// A credential someone has been through issuance for, whatever happened
// to it since: the team's secret exists (or did), so no model of that
// team's needs its first reveal.
const ISSUED_CREDENTIAL_STATUSES = ['active', 'revoked']

function tagClassForStatus(status) {
  return TAG_CLASS_BY_STATUS[status] ?? 'govuk-tag--grey'
}

function statusDisplayFor(credential) {
  if (credential.status !== 'active') {
    return {
      text: formatLabel(credential.status),
      tagClass: tagClassForStatus(credential.status)
    }
  }

  const daysLeft = Math.max(
    differenceInCalendarDays(new Date(credential.expiresAt), new Date()),
    0
  )

  return {
    text: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
    tagClass:
      daysLeft <= RESEARCH_EXPIRY_WARNING_DAYS
        ? 'govuk-tag--yellow'
        : 'govuk-tag--green'
  }
}

function keyRow(credential, modelNames) {
  const statusDisplay = statusDisplayFor(credential)

  return {
    ...credential,
    modelDisplayName: modelNames[credential.modelSlug] ?? credential.modelSlug,
    forText: 'You / Research',
    environment: credentialEnvironmentName(credential),
    statusText: statusDisplay.text,
    tagClass: statusDisplay.tagClass,
    runsOut: credential.expiresAt ? formatDate(credential.expiresAt) : null,
    showRenewRevoke: true
  }
}

/**
 * The "Keys you can use" rows: the person's own research keys. A team's
 * client secret is on the team's page, not here.
 * @param {object[]} credentials
 * @param {Record<string, string>} modelNames
 * @returns {object[]}
 */
export function buildKeyRows(credentials, modelNames) {
  return credentials
    .filter(
      (credential) =>
        credential.tier !== TEAM_TIER &&
        !UNISSUED_CREDENTIAL_STATUSES.includes(credential.status)
    )
    .map((credential) => keyRow(credential, modelNames))
}

// The team+environment pairs whose client secret has been issued.
function issuedTeamEnvironments(credentials) {
  return new Set(
    credentials
      .filter(
        (credential) =>
          credential.tier === 'team' &&
          ISSUED_CREDENTIAL_STATUSES.includes(credential.status)
      )
      .map((credential) => `${credential.teamId}:${credential.environment}`)
  )
}

// Where a model's row sends the person: a model being removed, or a ready
// one whose team secret has been revealed, goes to the team's page, where an
// admin manages it; a model still being set up or failed goes to its request
// page; a ready one whose team secret was never revealed goes there too, to
// finish.
function modelAction(deployment, { team, secretIssued }) {
  const requestUrl = `/connect/team/request/${deployment.teamId}/${deployment._id}`
  const teamPage = {
    href: `/teams/${encodeURIComponent(team?.slug ?? deployment.teamId)}`,
    text: `Manage in ${team?.name ?? 'Unknown team'}`
  }

  if (deployment.status === DEPLOYMENT_REMOVING_STATUS) {
    return teamPage
  }

  if (isDeploymentInProgress(deployment.status)) {
    return { href: requestUrl, text: 'Check progress' }
  }

  if (DEPLOYMENT_FAILURE_STATUSES.includes(deployment.status)) {
    return { href: requestUrl, text: 'See what happened' }
  }

  // An unknown status has no step to check or finish.
  if (deployment.status !== 'active') {
    return teamPage
  }

  return secretIssued
    ? teamPage
    : { href: requestUrl, text: 'Finish setting up' }
}

/**
 * The "Your models" rows: every model a person's teams have or are
 * changing, with where it has got to. A removed model is history and is
 * left to the team page.
 * @param {object[]} deployments
 * @param {object[]} credentials
 * @param {Map<string, object>} teamsById
 * @param {Record<string, string>} modelNames
 * @returns {object[]}
 */
export function buildModelRows(
  deployments,
  credentials,
  teamsById,
  modelNames
) {
  const issued = issuedTeamEnvironments(credentials)

  return deployments
    .filter((deployment) => deployment.status !== DEPLOYMENT_REMOVED_STATUS)
    .map((deployment) => {
      const teamName = teamsById.get(deployment.teamId)?.name ?? 'Unknown team'

      return {
        id: deployment._id,
        modelDisplayName:
          modelNames[deployment.modelSlug] ?? deployment.modelSlug,
        teamName,
        environment: environmentName(deployment.environment),
        status: deployment.status,
        statusText: deploymentStatusText(deployment.status),
        tagClass: deploymentTagClass(deployment.status),
        inProgress: isDeploymentInProgress(deployment.status),
        failureReason: deployment.failureReason ?? null,
        action: modelAction(deployment, {
          team: teamsById.get(deployment.teamId),
          secretIssued: issued.has(
            `${deployment.teamId}:${deployment.environment}`
          )
        })
      }
    })
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

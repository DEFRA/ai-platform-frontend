// How a team's model deployment reads on a page, from the status the
// backend keeps for it (design C states grouped for people, never shown
// raw). Shared by the Manage page and the team page.

const QUEUED = 'queued'
const REMOVING = 'removing'
const REMOVED = 'removed'
const FAILURE_STATUSES = ['checks-failed', 'deploy-failed']

const TEXT_BY_STATUS = {
  active: 'Ready to view',
  [QUEUED]: 'Waiting for another change',
  [REMOVING]: 'Removing',
  [REMOVED]: 'Removed'
}

const TAG_CLASS_BY_STATUS = {
  active: 'govuk-tag--green',
  [QUEUED]: 'govuk-tag--grey',
  [REMOVING]: 'govuk-tag--yellow',
  [REMOVED]: 'govuk-tag--grey'
}

/**
 * The short status a person sees for a deployment.
 * @param {string} status - The backend's deployment status.
 * @returns {string}
 */
function deploymentStatusText(status) {
  if (FAILURE_STATUSES.includes(status)) {
    return 'Setup failed'
  }

  return TEXT_BY_STATUS[status] ?? 'Setting up'
}

/**
 * The GOV.UK tag class for a deployment status.
 * @param {string} status - The backend's deployment status.
 * @returns {string}
 */
function deploymentTagClass(status) {
  if (FAILURE_STATUSES.includes(status)) {
    return 'govuk-tag--red'
  }

  return TAG_CLASS_BY_STATUS[status] ?? 'govuk-tag--yellow'
}

/**
 * Whether a deployment is still changing, so a page showing it refreshes.
 * @param {string} status - The backend's deployment status.
 * @returns {boolean}
 */
function isDeploymentInProgress(status) {
  return (
    status !== 'active' &&
    status !== REMOVED &&
    !FAILURE_STATUSES.includes(status)
  )
}

export {
  deploymentStatusText,
  deploymentTagClass,
  FAILURE_STATUSES as DEPLOYMENT_FAILURE_STATUSES,
  isDeploymentInProgress,
  QUEUED as DEPLOYMENT_QUEUED_STATUS,
  REMOVED as DEPLOYMENT_REMOVED_STATUS,
  REMOVING as DEPLOYMENT_REMOVING_STATUS
}

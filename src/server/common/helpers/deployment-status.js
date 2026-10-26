// How a team's model deployment reads on a page, from the status the
// backend keeps for it (design C states grouped for people, never shown
// raw). Shared by the Manage page and the team page.

const QUEUED = 'queued'
const REMOVING = 'removing'
const REMOVED = 'removed'
const FAILURE_STATUSES = ['checks-failed', 'deploy-failed', 'timed-out']
// Every GitOps state between a request and a working deployment. A status
// the backend adds must be added here, or it reads as unknown.
const SETTING_UP_STATUSES = [
  'requested',
  'committed',
  'deploying',
  'deployed',
  'verified'
]
const UNKNOWN_TEXT = 'Status unknown'
const GREY_TAG = 'govuk-tag--grey'
const YELLOW_TAG = 'govuk-tag--yellow'

const TEXT_BY_STATUS = {
  active: 'Ready to use',
  // A request also waits while its environment is paused, so the label does
  // not say why.
  [QUEUED]: 'Waiting',
  [REMOVING]: 'Removing',
  [REMOVED]: 'Removed',
  ...Object.fromEntries(
    SETTING_UP_STATUSES.map((status) => [status, 'Setting up'])
  ),
  ...Object.fromEntries(
    FAILURE_STATUSES.map((status) => [status, 'Setup failed'])
  )
}

const TAG_CLASS_BY_STATUS = {
  active: 'govuk-tag--green',
  [QUEUED]: GREY_TAG,
  [REMOVING]: YELLOW_TAG,
  [REMOVED]: GREY_TAG,
  ...Object.fromEntries(
    SETTING_UP_STATUSES.map((status) => [status, YELLOW_TAG])
  ),
  ...Object.fromEntries(
    FAILURE_STATUSES.map((status) => [status, 'govuk-tag--red'])
  )
}

const IN_PROGRESS_STATUSES = new Set([QUEUED, REMOVING, ...SETTING_UP_STATUSES])

/**
 * The short status a person sees for a deployment. A status not listed
 * above reads as unknown, never as progress.
 * @param {string} status - The backend's deployment status.
 * @returns {string}
 */
function deploymentStatusText(status) {
  return TEXT_BY_STATUS[status] ?? UNKNOWN_TEXT
}

/**
 * The GOV.UK tag class for a deployment status.
 * @param {string} status - The backend's deployment status.
 * @returns {string}
 */
function deploymentTagClass(status) {
  return TAG_CLASS_BY_STATUS[status] ?? GREY_TAG
}

/**
 * Whether a deployment is still changing, so its page keeps checking.
 * @param {string} status - The backend's deployment status.
 * @returns {boolean}
 */
function isDeploymentInProgress(status) {
  return IN_PROGRESS_STATUSES.has(status)
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

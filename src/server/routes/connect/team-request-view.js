// The wait page groups every intermediate GitOps state into one friendly
// "being set up" message - it never shows raw GitOps jargon to the user (B09).
// GitOps applies one change per team file at a time, so a request made while
// another is in flight waits as `queued`, which gets its own wording.
export const QUEUED_STATUS = 'queued'
export const IN_PROGRESS_STATUSES = [
  QUEUED_STATUS,
  'requested',
  'pr-raised',
  'merged',
  'deploying',
  'deployed',
  'verified'
]
export const FAILURE_STATUSES = ['checks-failed', 'deploy-failed']

/**
 * The heading of the wait page for a deployment still in progress.
 * @param {string} status
 * @returns {string}
 */
export function waitPageHeading(status) {
  return status === QUEUED_STATUS
    ? 'Waiting for another change to this team to finish'
    : 'Setting up your team client secret'
}

// Support links to the GitOps runs and pull request behind a team request,
// when the backend has them. Labelled here, and only https links are shown.
const PIPELINE_LINK_LABELS = {
  submitRun: 'Submit workflow run',
  pullRequest: 'Pull request',
  applyRun: 'Apply workflow run'
}

/**
 * The GitOps links worth showing for a request, labelled and https only.
 * @param {Record<string, unknown>} [links]
 * @returns {Array<{href: string, text: string}>}
 */
export function buildPipelineLinks(links = {}) {
  return Object.entries(PIPELINE_LINK_LABELS)
    .filter(
      ([key]) =>
        typeof links[key] === 'string' && links[key].startsWith('https://')
    )
    .map(([key, text]) => ({ href: links[key], text }))
}

// The wait page groups every intermediate GitOps state into one friendly
// "being set up" message - it never shows raw GitOps jargon to the user (B09).
// GitOps applies one change per team file at a time, so a request made while
// another is in flight waits as `queued`, which gets its own wording.
import {
  DEPLOYMENT_FAILURE_STATUSES,
  DEPLOYMENT_SETTING_UP_STATUSES
} from '#/server/common/helpers/deployment-status.js'

export const QUEUED_STATUS = 'queued'
export const IN_PROGRESS_STATUSES = [
  QUEUED_STATUS,
  ...DEPLOYMENT_SETTING_UP_STATUSES
]
export const FAILURE_STATUSES = DEPLOYMENT_FAILURE_STATUSES

// The only state in which the team's client secret is being made.
const SECRET_STEP_STATUS = 'verified'

/**
 * The heading of the wait page, from the statuses of the deployments it
 * is waiting on: the client secret is promised only once every one of
 * them has reached that step.
 * @param {string[]} statuses
 * @returns {string}
 */
export function waitPageHeading(statuses) {
  if (statuses.every((status) => status === QUEUED_STATUS)) {
    return 'Waiting for another change to this team to finish'
  }

  return statuses.every((status) => status === SECRET_STEP_STATUS)
    ? 'Setting up your team client secret'
    : 'Setting up your model access'
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

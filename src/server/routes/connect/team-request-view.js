// What the pages that follow a team request say about it. GitOps applies one
// change per team file at a time, so a request made while another is in
// flight waits as `queued`, which gets its own wording; the raw GitOps states
// are never shown (B09).
import { formatDate } from '#/config/nunjucks/filters/format-date.js'

export {
  DEPLOYMENT_FAILURE_STATUSES as FAILURE_STATUSES,
  DEPLOYMENT_QUEUED_STATUS as QUEUED_STATUS
} from '#/server/common/helpers/deployment-status.js'

const REFERENCE_PREFIX = 'AIP-'
const REFERENCE_LENGTH = 5

// Only these two links help support on a failure, and only https ones are shown.
const PIPELINE_LINK_LABELS = {
  pullRequest: 'Pull request',
  applyRun: 'Apply run'
}

/**
 * The reference a person quotes to the AI Platform team (D8): `AIP-` and the
 * last five characters of the deployment's operation id, in upper case.
 * @param {string | null | undefined} operationId
 * @returns {string | null}
 */
export function supportReference(operationId) {
  if (typeof operationId !== 'string' || operationId.length === 0) {
    return null
  }

  return `${REFERENCE_PREFIX}${operationId.slice(-REFERENCE_LENGTH).toUpperCase()}`
}

function timeOf(at) {
  return at ? formatDate(at, 'HH:mm') : null
}

function stepHint(step) {
  const time = timeOf(step.at)

  if (!time) {
    return undefined
  }

  return step.state === 'current' ? `Started at ${time}` : time
}

/**
 * The backend's progress steps as step list items: a step the backend calls
 * `pending` is waiting, and each one with a time carries it as its hint
 * ("10:41", or "Started at 10:42" for the one in progress).
 * @param {Array<{label: string, state: string, at?: string | null}> | null | undefined} progressSteps
 * @returns {Array<{text: string, state: string, hint?: string}>}
 */
export function buildStepItems(progressSteps) {
  return (progressSteps ?? []).map((step) => ({
    text: step.label,
    state: step.state === 'pending' ? 'waiting' : step.state,
    hint: stepHint(step)
  }))
}

/**
 * The GitOps links worth showing for a failure, labelled and https only.
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

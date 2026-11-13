import {
  deploymentStatusText,
  deploymentTagClass
} from '#/server/common/helpers/deployment-status.js'

// The words for a team's deployment in one environment (plan D17, F6). The
// backend gives the worst state of the team's models there as a word and a
// credential's state as a word; the page says them plainly, with a tag whose
// words carry the meaning and whose colour only helps.

const GREY_TAG = 'govuk-tag--grey'
const YELLOW_TAG = 'govuk-tag--yellow'
const UNKNOWN_TEXT = 'Status unknown'

const STATUS_TAGS = {
  ready: { text: 'Ready', classes: 'govuk-tag--green' },
  'setting-up': { text: 'Setting up', classes: YELLOW_TAG },
  waiting: { text: 'Waiting', classes: GREY_TAG },
  removing: { text: 'Removing', classes: YELLOW_TAG },
  'needs-attention': { text: 'Needs attention', classes: 'govuk-tag--red' }
}

const CREDENTIAL_TAGS = {
  active: { text: 'Active', classes: 'govuk-tag--green' },
  disabled: { text: 'Disabled', classes: 'govuk-tag--orange' },
  revoked: { text: 'Revoked', classes: 'govuk-tag--red' },
  none: { text: 'None', classes: GREY_TAG }
}

function filterChoices(all, tags) {
  return [
    { value: '', text: all },
    ...Object.entries(tags).map(([value, { text }]) => ({ value, text }))
  ]
}

/** What the Status filter offers, the first meaning "no filter". */
export const STATUS_FILTERS = filterChoices('All statuses', STATUS_TAGS)

/** What the Credential filter offers, the first meaning "no filter". */
export const CREDENTIAL_FILTERS = filterChoices(
  'All credentials',
  CREDENTIAL_TAGS
)

/**
 * The tag for the worst state of a team's models in an environment.
 * @param {string} status
 * @returns {{text: string, classes: string}}
 */
export function statusTag(status) {
  return STATUS_TAGS[status] ?? { text: UNKNOWN_TEXT, classes: GREY_TAG }
}

/**
 * The tag for a credential's state.
 * @param {string} status
 * @returns {{text: string, classes: string}}
 */
export function credentialTag(status) {
  return CREDENTIAL_TAGS[status] ?? { text: status, classes: GREY_TAG }
}

/**
 * A credential's state from what the backend gave: a word, or an object with
 * a `status`. Nothing means none.
 * @param {string | {status: string} | null | undefined} credential
 * @returns {string}
 */
export function credentialStatus(credential) {
  if (typeof credential === 'string') {
    return credential
  }

  return credential?.status ?? 'none'
}

/**
 * What a credential state stands on. A block (`disabled`) hides the state of
 * the credential under it; the backend says it as `held`: `active`, `revoked`
 * or `none`. A block it did not say it for is `unknown`; any other state is
 * its own.
 * @param {string | {status: string, held?: string} | null | undefined} credential
 * @returns {string}
 */
export function credentialHeld(credential) {
  const status = credentialStatus(credential)

  if (status !== 'disabled') {
    return status
  }

  return typeof credential?.held === 'string' ? credential.held : 'unknown'
}

/**
 * The tag for one model's own state in the health table, in the words the
 * team's pages use.
 * @param {string} status - The deployment's own status.
 * @returns {{text: string, classes: string}}
 */
export function modelStatusTag(status) {
  return {
    text: deploymentStatusText(status),
    classes: deploymentTagClass(status)
  }
}

// The words for what the audit log records (plan D9). The backend stores a
// code for each action; the page says it plainly. An action with no label yet
// (a new one from the backend) shows as its code, so nothing is hidden.

const ACTION_LABELS = {
  'user.signIn': 'Signed in',
  'team.create': 'Created a team',
  'team.setServiceCode': 'Changed the service code',
  'team.setDescription': 'Changed the description',
  'team.addMember': 'Added a member',
  'team.removeMember': 'Removed a member',
  'team.setMemberRole': 'Changed a member’s role',
  'teamDeployment.request': 'Requested an environment',
  'teamDeployment.remove': 'Removed an environment',
  'teamDeployment.retry': 'Retried an environment request',
  'teamDeployment.reconcile': 'Reconciled an environment',
  'teamDeployment.credential': 'Set up the team credential',
  'teamDeployment.transition': 'Environment changed state',
  'teamDeployment.verificationFailed': 'Environment check failed',
  'teamLimits.change': 'Changed the team’s limits',
  'operation.external': 'Platform operation',
  'credential.issue': 'Issued a credential',
  'credential.renew': 'Renewed a credential',
  'credential.rotate': 'Rotated a credential',
  'credential.revoke': 'Revoked a credential',
  'credential.reveal': 'Revealed a credential',
  'credential.expire': 'Expired a credential',
  'access.denied': 'Access refused'
}

const ACCESS_DENIED = 'access.denied'

// What an access refusal was for, by the code the backend gave.
const REFUSAL_LABELS = {
  'not-a-member': 'Refused: not a member of the team',
  'admin-required': 'Refused: Team Admin role needed',
  'platform-admin-required': 'Refused: Platform Admin role needed',
  'self-add-refused': 'Refused: adding yourself to a team'
}

/**
 * The kinds of person or step that acted, in the order the filter lists them
 * (plan D5).
 */
export const ACTOR_TYPES = [
  { value: 'platform-admin', text: 'Platform Admin' },
  { value: 'team-admin', text: 'Team Admin' },
  { value: 'team-member', text: 'Team member' },
  { value: 'person', text: 'Person with no team role' },
  { value: 'system', text: 'System' }
]

/**
 * The actions the filter offers, by plain label.
 */
export const ACTION_OPTIONS = Object.entries(ACTION_LABELS)
  .map(([value, text]) => ({ value, text }))
  .sort((a, b) => a.text.localeCompare(b.text))

/**
 * What an event did, in plain words. A refusal says what it was for.
 * @param {{action: string, code?: string | null}} event
 * @returns {string}
 */
export function actionLabel({ action, code }) {
  if (action === ACCESS_DENIED) {
    if (!code) {
      return ACTION_LABELS[ACCESS_DENIED]
    }

    return REFUSAL_LABELS[code] ?? `${ACTION_LABELS[ACCESS_DENIED]} (${code})`
  }

  return ACTION_LABELS[action] ?? action
}

/**
 * What kind of actor the backend named.
 * @param {string} type
 * @returns {string}
 */
export function actorTypeLabel(type) {
  return ACTOR_TYPES.find(({ value }) => value === type)?.text ?? type
}

/**
 * The outcome as a GOV.UK tag: the words carry the meaning, the colour only
 * helps.
 * @param {{outcome: string, action: string}} event
 * @returns {{text: string, classes: string}}
 */
export function outcomeTag({ outcome, action }) {
  if (outcome === 'success') {
    return { text: 'Done', classes: 'govuk-tag--green' }
  }

  return action === ACCESS_DENIED
    ? { text: 'Refused', classes: 'govuk-tag--orange' }
    : { text: 'Failed', classes: 'govuk-tag--red' }
}

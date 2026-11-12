// How a team's status is shown, as a GOV.UK tag. The status itself is the
// backend's (`teams.status`; a team with none reads as active).
const STATUS_TAGS = {
  active: { text: 'Active', classes: 'govuk-tag--green' },
  disabled: { text: 'Disabled', classes: 'govuk-tag--grey' },
  'pending-removal': { text: 'Pending removal', classes: 'govuk-tag--orange' },
  // Only a team file can be this: the team's own status never is.
  removed: { text: 'Removed', classes: 'govuk-tag--red' }
}

/**
 * The tag for a team's status: its words and its colour. A status this page
 * does not know is shown as it is, in grey, so it is never hidden.
 * @param {string | undefined} status
 * @returns {{text: string, classes: string}}
 */
export function teamStatusTag(status) {
  return (
    STATUS_TAGS[status ?? 'active'] ?? {
      text: String(status),
      classes: 'govuk-tag--grey'
    }
  )
}

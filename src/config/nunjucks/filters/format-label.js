// Presenter layer: maps raw enum values from the API to the copy people see.
// Add new raw -> shown pairs here rather than string-swapping in templates.
const LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  uksouth: 'UK South',
  uk: 'UK South',
  active: 'Active',
  pending: 'Setting up',
  revoked: 'Revoked',
  expired: 'Expired',
  failed: 'Failed',
  approved: 'Approved',
  'not-approved': 'Not approved',
  planned: 'Planned',
  research: 'Research',
  team: 'Team'
}

export function formatLabel(value) {
  if (value == null) {
    return value
  }

  return LABELS[value] ?? value
}

export function formatLabelList(values) {
  return (values ?? []).map(formatLabel).join(', ')
}

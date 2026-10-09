// Presenter layer: maps raw enum values from the API to the copy people see.
// Add new raw -> shown pairs here rather than string-swapping in templates.
const LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  meta: 'Meta',
  uksouth: 'UK South',
  active: 'Active',
  pending: 'Setting up',
  revoked: 'Revoked',
  expired: 'Expired',
  failed: 'Failed',
  approved: 'Approved',
  'not-approved': 'Not approved',
  planned: 'Planned',
  research: 'Research',
  team: 'Team',
  available: 'Available',
  deprecated: 'Being retired soon',
  retired: 'Retired'
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

const DATA_ZONE_LABELS = { uk: 'UK', eu: 'EU' }

export function formatDataZone(value) {
  if (value == null) {
    return value
  }

  return DATA_ZONE_LABELS[value] ?? value
}

// Presenter layer: maps raw enum values from the API to the copy people see.
// Add new raw -> shown pairs here rather than string-swapping in templates.
const LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  meta: 'Meta',
  uksouth: 'UK South',
  ukwest: 'UK West',
  swedencentral: 'Sweden Central',
  northeurope: 'North Europe',
  westeurope: 'West Europe'
}

export function formatLabel(value) {
  if (value == null) {
    return value
  }

  return LABELS[value] ?? value
}

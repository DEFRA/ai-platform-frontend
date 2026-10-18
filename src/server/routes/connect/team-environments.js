import { config } from '#/config/config.js'

// The environments this instance deploys a team's models to (D1): the CDP
// dev instance drives Infradev, the test instance the Sandbox. Shown as
// radios from the configured list, the first preselected; the backend
// refuses anything outside its own list as `environment-not-available`.
const ENVIRONMENT_NAMES = {
  infradev: 'Infradev',
  sandbox: 'Sandbox',
  dev: 'Development',
  qa: 'QA',
  test: 'Test',
  preprod: 'Pre-production',
  prod: 'Production',
  uat: 'UAT'
}

/**
 * The environments a team may choose from, in configured order.
 * @returns {string[]}
 */
export function environmentValues() {
  return config.get('teamEnvironments')
}

/**
 * The environments a team may choose from, as GOV.UK radio items.
 * @returns {Array<{value: string, text: string, checked: boolean}>}
 */
export function environmentItems() {
  return environmentValues().map((value, index) => ({
    value,
    text: ENVIRONMENT_NAMES[value] ?? value,
    checked: index === 0
  }))
}

/**
 * One line saying which environments are available today.
 * @returns {string}
 */
export function environmentHint() {
  const names = environmentItems().map((item) => item.text)

  return names.length === 1
    ? `Only ${names[0]} is available today.`
    : `Available today: ${names.join(', ')}.`
}

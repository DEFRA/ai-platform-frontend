import { config } from '#/config/config.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'

// The environments this instance deploys a team's models to (D1): the CDP
// dev instance drives Infradev, the test instance the Sandbox. Shown as
// radios from the configured list; the backend refuses anything outside its
// own list as `environment-not-available`.

/**
 * The environments a team may choose from, in configured order.
 * @returns {string[]}
 */
export function environmentValues() {
  return config.get('teamEnvironments')
}

/**
 * The environments a team may choose from, as GOV.UK radio items, with the
 * one already chosen checked, or the first when nothing has been chosen.
 * @param {string} [selected]
 * @returns {Array<{value: string, text: string, checked: boolean}>}
 */
export function environmentItems(selected) {
  const values = environmentValues()
  const checked = values.includes(selected) ? selected : values[0]

  return values.map((value) => ({
    value,
    text: environmentName(value),
    checked: value === checked
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

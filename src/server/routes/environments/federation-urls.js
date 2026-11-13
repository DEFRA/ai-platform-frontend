import { environmentPageUrl } from '#/server/common/helpers/environment-names.js'

const BASE = '/environments'

/**
 * The address of a step of the Federate journey, for a team. The journey is
 * the team's, started from the overview or from an environment's page (which
 * it then ticks first).
 * @param {string} teamSlug
 * @param {string} [step] - '' for the first question, else the step's name.
 * @param {{environment?: string, change?: boolean}} [options]
 * @returns {string}
 */
export function federateUrl(teamSlug, step = '', options = {}) {
  const query = new URLSearchParams()

  if (options.environment) {
    query.set('environment', options.environment)
  }

  if (options.change) {
    query.set('change', 'check')
  }

  const stepPath = step ? `/${step}` : ''
  const path = `${BASE}/${encodeURIComponent(teamSlug)}/federate${stepPath}`

  return query.size > 0 ? `${path}?${query}` : path
}

/**
 * The address of the page that follows one federation just made: each one has
 * its own, so two made in one session do not show each other's operations.
 * @param {string} teamSlug
 * @param {string} id - The id the federation was given when it was made.
 * @returns {string}
 */
export function federateProgressUrl(teamSlug, id) {
  return federateUrl(teamSlug, `progress/${encodeURIComponent(id)}`)
}

/**
 * The address of an action on one environment's application (change or
 * remove), which only an admin takes.
 * @param {string} teamSlug
 * @param {string} environment - The environment code.
 * @param {string} federationId
 * @param {'change' | 'remove'} action
 * @returns {string}
 */
export function applicationUrl(teamSlug, environment, federationId, action) {
  return `${environmentPageUrl(teamSlug, environment)}/applications/${encodeURIComponent(federationId)}/${action}`
}

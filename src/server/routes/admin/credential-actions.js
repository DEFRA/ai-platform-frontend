// What each credential action can be done to: an environment is offered an
// action by its credential's state (P1-AC11). The backend decides again on
// every call.

import { environmentName } from '#/server/common/helpers/environment-names.js'
import { credentialHeld, credentialStatus } from './deployment-labels.js'

// What a credential can be revoked from: one the team holds. A block the
// backend did not say what is under (it always does) is not offered.
const HELD = new Set(['active'])

const RULES = {
  // A block outlasts a revoked or missing credential: it stops a new one
  // being created, so only an environment already disabled is not offered.
  disable: (credential) => credentialStatus(credential) !== 'disabled',
  // Only a credential the team still holds can be revoked: one that is
  // active, or under a block that holds an active one.
  revoke: (credential) => HELD.has(credentialHeld(credential)),
  // Only a block can be lifted; a revoked credential stays revoked.
  enable: (credential) => credentialStatus(credential) === 'disabled'
}

/** The actions, in the order their buttons show. */
export const OFFERED = ['disable', 'enable', 'revoke']

/**
 * Whether an action is offered for an environment whose credential is as
 * given.
 * @param {string} action - disable, enable or revoke.
 * @param {string | {status: string, held?: string} | null | undefined} credential
 *   - What the backend gave: a status word or an object with a status.
 * @returns {boolean}
 */
export function isOffered(action, credential) {
  return RULES[action]?.(credential) ?? false
}

// What a credential is like once the action has been done to it.
const DONE = {
  disable: (credential) => credentialStatus(credential) === 'disabled',
  revoke: (credential) => credentialHeld(credential) === 'revoked'
}

/**
 * Whether an action has been done to an environment: its credential is
 * disabled (Disable) or revoked, blocked or not (Revoke). A confirmation page
 * says an action happened only when this is so.
 * @param {string} action - disable or revoke.
 * @param {string | {status: string, held?: string} | null | undefined} credential
 * @returns {boolean}
 */
export function isDone(action, credential) {
  return DONE[action]?.(credential) ?? false
}

/**
 * What each action says and looks like. `effect` is what is true after it in
 * phase 1 (plan D9): the credentials of a team, not its gateway access.
 */
export const CREDENTIAL_ACTIONS = {
  disable: {
    title: 'Disable credentials',
    needsReason: true,
    buttonClasses: 'govuk-button--secondary',
    effect:
      'The team cannot create new credentials or view or rotate its secrets in these environments. The team is not told why.',
    done: 'Credentials disabled',
    past: 'disabled',
    verbing: 'disabling',
    notDone: 'disable'
  },
  enable: {
    title: 'Enable credentials',
    needsReason: false,
    buttonClasses: '',
    done: 'Credentials enabled',
    past: 'enabled',
    verbing: 'enabling',
    notDone: 'enable'
  },
  revoke: {
    title: 'Revoke credentials',
    needsReason: true,
    buttonClasses: 'govuk-button--warning',
    effect:
      'Revoking cannot be undone. The secrets are deleted. The team is not told why.',
    done: 'Credentials revoked',
    past: 'revoked',
    verbing: 'revoking',
    notDone: 'revoke'
  }
}

const MOST_ENVIRONMENTS = 10

/**
 * A credential's state in an environment of the deployment: its own entry in
 * the list, or the page's own credential for the environment the page is for.
 * @param {object} deployment - What the backend gave for the page.
 * @param {string} environment
 * @returns {string | object | null}
 */
export function credentialIn(deployment, environment) {
  const entry = deployment.environments?.find(
    (candidate) => candidate.environment === environment
  )

  return (
    entry?.credential ??
    (environment === deployment.environment ? deployment.credential : null)
  )
}

// Why Disable is still offered where there is nothing to disable.
const DISABLE_HINTS = {
  revoked:
    'Its credential is revoked. Disabling stops a new one being created.',
  none: 'It has no credential yet. Disabling stops one being created.'
}

/**
 * The choices of "Which environments?": each environment of the team the
 * action is offered for, in the order the backend lists them, with the ones in
 * `ticked` ticked (plan D11).
 * @param {string} action - disable, enable or revoke.
 * @param {object} deployment - What the backend gave for the page.
 * @param {string[]} ticked - The environment codes to tick.
 * @returns {Array<{value: string, text: string, checked: boolean, hint?: {text: string}}>}
 */
export function environmentChoices(action, deployment, ticked) {
  const codes = new Set([
    ...(deployment.environments ?? []).map(({ environment }) => environment),
    deployment.environment
  ])

  return [...codes]
    .map((environment) => ({
      environment,
      credential: credentialIn(deployment, environment)
    }))
    .filter(({ credential }) => isOffered(action, credential))
    .map(({ environment, credential }) => ({
      value: environment,
      text: environmentName(environment),
      checked: ticked.includes(environment),
      ...(action === 'disable' && DISABLE_HINTS[credentialStatus(credential)]
        ? { hint: { text: DISABLE_HINTS[credentialStatus(credential)] } }
        : {})
    }))
}

/**
 * The environments a form or an address names, as a list of codes without
 * blanks or repeats, and no more than a team could have. A form gives one
 * value or several; an address gives a comma list.
 * @param {unknown} value
 * @returns {string[]}
 */
export function readEnvironments(value) {
  const values = Array.isArray(value) ? value : [value]
  const codes = values
    .filter((item) => typeof item === 'string')
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean)

  return [...new Set(codes)].slice(0, MOST_ENVIRONMENTS)
}

/**
 * Whether the environments asked for can be acted on: each is one the team
 * has (else the page is as for a deployment that does not exist) and one the
 * action is offered for. The backend decides again.
 * @param {string} action
 * @param {object} deployment
 * @param {string[]} requested
 * @returns {{environments: string[]} | {problem: 'none' | 'unknown' | 'not-offered'}}
 */
export function resolveEnvironments(action, deployment, requested) {
  const known = new Set([
    ...(deployment.environments ?? []).map(({ environment }) => environment),
    deployment.environment
  ])

  if (requested.length === 0) {
    return { problem: 'none' }
  }

  if (requested.some((environment) => !known.has(environment))) {
    return { problem: 'unknown' }
  }

  return requested.every((environment) =>
    isOffered(action, credentialIn(deployment, environment))
  )
    ? { environments: requested }
    : { problem: 'not-offered' }
}

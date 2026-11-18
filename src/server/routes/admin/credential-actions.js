// What each credential action can be done to: an environment is offered an
// action by its credential's state (P1-AC11). The backend decides again on
// every call.

import { environmentName } from '#/server/common/helpers/environment-names.js'
import {
  formatUkDate,
  formatUkTimeWithZone
} from '#/server/common/helpers/uk-time.js'
import { credentialStatus } from './deployment-labels.js'

const RULES = {
  // A block outlasts a revoked or missing credential: it stops a new one
  // being created, so only an environment already disabled is not offered.
  disable: (credential) => credentialStatus(credential) !== 'disabled',
  // Only a block can be lifted; a revoked credential stays revoked.
  enable: (credential) => credentialStatus(credential) === 'disabled'
}

/** The actions, in the order their buttons show. */
export const OFFERED = ['disable', 'enable']

/**
 * Whether an action is offered for an environment whose credential is as
 * given.
 * @param {string} action - disable or enable.
 * @param {string | {status: string, held?: string} | null | undefined} credential
 *   - What the backend gave: a status word or an object with a status.
 * @returns {boolean}
 */
export function isOffered(action, credential) {
  return RULES[action]?.(credential) ?? false
}

// What a credential is like once the action has been done to it.
const DONE = {
  disable: (credential) => credentialStatus(credential) === 'disabled'
}

/**
 * Whether an action has been done to an environment: its credential is
 * disabled (Disable). A confirmation page says an action happened only when
 * this is so.
 * @param {string} action - disable.
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
      'Calls using the team’s credentials in these environments stop within 60 seconds. The team cannot create new credentials or view or rotate its secrets there. The team is not told why.',
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

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const SECONDS_PER_HOUR = 3600
const CLOCK_SKEW_SECONDS = 60
// The longest the gateway accepts a token Entra issued: 2 hours from `iat` to
// `exp` and 60 seconds of clock skew (design F, "Enable after a leak").
const TOKEN_LIMIT_MS =
  (2 * SECONDS_PER_HOUR + CLOCK_SKEW_SECONDS) * MS_PER_SECOND

/**
 * What the Enable page says about tokens issued before the Disable in one
 * environment: the moment from which none can work again, or that none is
 * recorded. Nothing is said when Enable is not offered for the environment.
 * @param {object} deployment - What the backend gave for the page.
 * @param {string} environment
 * @returns {string | null}
 */
export function enableNote(deployment, environment) {
  if (!isOffered('enable', credentialIn(deployment, environment))) {
    return null
  }

  const { servicePrincipalDisabledAt } =
    deployment.environments?.find(
      (candidate) => candidate.environment === environment
    ) ?? {}
  const where = environmentName(environment)

  if (!servicePrincipalDisabledAt) {
    return `There is no record of when the service principal for ${where} was disabled, so no time can be shown. A token issued before the credentials were disabled can work again once you enable them.`
  }

  const moment = new Date(
    Math.ceil(
      (Date.parse(servicePrincipalDisabledAt) + TOKEN_LIMIT_MS) / MS_PER_MINUTE
    ) * MS_PER_MINUTE
  ).toISOString()

  return `Enabling does not undo what happened before the Disable. A token issued before the credentials were disabled in ${where} can work again if you enable them before ${formatUkTimeWithZone(moment)} on ${formatUkDate(moment)}. From then on, none can. After a leaked secret, revoke the secret and enable after that time. After a mistaken Disable, you can enable at once.`
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
 * @param {string} action - disable or enable.
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

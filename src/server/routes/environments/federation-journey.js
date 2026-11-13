import { randomUUID } from 'node:crypto'

import {
  environmentPageUrl,
  teamEnvironmentsUrl
} from '#/server/common/helpers/environment-names.js'
import {
  getPendingFederation,
  getSessionUser,
  setPendingFederation
} from '#/server/common/helpers/session.js'
import { federateUrl } from './federation-urls.js'
import { HOSTS } from './federation-answers.js'

// The Federate journey, one question to a page: where the application runs,
// its CDP service or its Azure principal ID and then name, which environments
// should trust it, then the answers to check. The same questions change an
// existing application (an admin's Change), which asks nothing about
// environments. The answers wait in the session with the key that makes
// confirming them the same request however many times it is sent.
export const STEP = {
  where: '',
  service: 'service',
  principalId: 'principal-id',
  name: 'name',
  environments: 'environments',
  check: 'check'
}

export const KIND = { add: 'add', change: 'change' }

// What makes one request different from another; a changed answer is a new
// request with a new key, the same answers keep theirs.
const ANSWER_FIELDS = [
  'kind',
  'host',
  'service',
  'principalId',
  'name',
  'environments',
  'target'
]

function fingerprint(pending) {
  return JSON.stringify(ANSWER_FIELDS.map((field) => pending?.[field] ?? null))
}

function firstQuestionOf(pending) {
  return pending.host === HOSTS.cdp ? STEP.service : STEP.principalId
}

function lastQuestionOf(pending) {
  return pending.host === HOSTS.cdp ? STEP.service : STEP.name
}

/**
 * The step a person goes to after answering one.
 * @param {{kind: string, host: string}} pending
 * @param {string} current - A `STEP` value.
 * @returns {string}
 */
export function stepAfter(pending, current) {
  if (current === STEP.where) {
    return firstQuestionOf(pending)
  }

  if (current === STEP.principalId) {
    return STEP.name
  }

  if (current === STEP.environments) {
    return STEP.check
  }

  return pending.kind === KIND.change ? STEP.check : STEP.environments
}

/**
 * The step before another, for its Back link; null when it is the first of
 * the journey, which goes back to the page the person came from.
 * @param {{kind: string, host: string, environmentsSkipped?: boolean}} pending
 * @param {string} current - A `STEP` value.
 * @returns {string | null}
 */
export function stepBefore(pending, current) {
  const change = pending.kind === KIND.change

  if (current === STEP.where) {
    return null
  }

  if (current === STEP.name) {
    return STEP.principalId
  }

  if (current === STEP.environments) {
    return lastQuestionOf(pending)
  }

  if (current === STEP.check) {
    return change || pending.environmentsSkipped
      ? lastQuestionOf(pending)
      : STEP.environments
  }

  return change ? null : STEP.where
}

/**
 * The address of the step before another, or of the page the journey came
 * from: the environment it was started from or changes, else the overview.
 * @param {{slug: string}} team
 * @param {object} pending
 * @param {string} current
 * @returns {string}
 */
export function backUrl(team, pending, current) {
  const before = stepBefore(pending, current)

  if (before !== null) {
    return federateUrl(team.slug, before)
  }

  const environment = pending.target?.environment ?? pending.start

  return environment
    ? environmentPageUrl(team.slug, environment)
    : teamEnvironmentsUrl(team.slug)
}

/**
 * The journey this person has under way for this team, or undefined. One
 * left by anyone else, or for another team, is not theirs to continue.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamSlug
 * @returns {object | undefined}
 */
export function pendingFor(request, teamSlug) {
  const pending = getPendingFederation(request)

  return pending &&
    pending.userId === getSessionUser(request)?.id &&
    pending.teamSlug === teamSlug
    ? pending
    : undefined
}

/**
 * Keeps the answers given so far. The same answers keep their key, different
 * ones get a new one.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamSlug
 * @param {object} changes - Answers to add to those held.
 * @returns {object} What is now held.
 */
export function savePending(request, teamSlug, changes) {
  const known = pendingFor(request, teamSlug)
  const next = {
    ...known,
    ...changes,
    userId: getSessionUser(request).id,
    teamSlug
  }
  const same = known?.key && fingerprint(known) === fingerprint(next)
  const saved = { ...next, key: same ? known.key : randomUUID() }

  setPendingFederation(request, saved)

  return saved
}

/**
 * Starts a journey afresh (nothing from an earlier one carries over).
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamSlug
 * @param {object} answers - What it starts with: `kind` and what is known.
 * @returns {object}
 */
export function startPending(request, teamSlug, answers) {
  const saved = {
    ...answers,
    userId: getSessionUser(request).id,
    teamSlug,
    key: randomUUID()
  }

  setPendingFederation(request, saved)

  return saved
}

/**
 * Whether the journey holds the answers to its questions, so it can be checked.
 * @param {object | undefined} pending
 * @returns {boolean}
 */
export function isAnswered(pending) {
  if (!pending?.host) {
    return false
  }

  if (pending.host === HOSTS.cdp) {
    return Boolean(pending.service) && hasEnvironments(pending)
  }

  return (
    Boolean(pending.principalId && pending.name) && hasEnvironments(pending)
  )
}

function hasEnvironments(pending) {
  return Array.isArray(pending.environments) && pending.environments.length > 0
}

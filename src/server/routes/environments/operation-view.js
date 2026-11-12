// What a team's members are shown of one change to their team's files (an
// operation), in words: what it does, who asked and when, the five steps with
// the time each was reached, and, when a step failed, why, with the run to
// follow and the reference to quote. The backend decides the steps and their
// states; nothing here restates its state names.
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { environmentRegistryName } from '#/server/common/helpers/environment-names.js'
import { joinNames } from '#/server/routes/connect/team-model-choices.js'
import { maskIfAddress } from '#/server/routes/teams/team-view.js'

const numberFormat = new Intl.NumberFormat('en-GB')

// The step list's states for the backend's step statuses; a status it does
// not know reads as not started.
const STEP_STATE = {
  done: 'done',
  current: 'current',
  failed: 'failed'
}

const RESULT_DONE = { text: 'Done', tagClass: 'govuk-tag--green' }
const RESULT_FAILED = { text: 'Failed', tagClass: 'govuk-tag--red' }
const RESULT_IN_PROGRESS = {
  text: 'In progress',
  tagClass: 'govuk-tag--yellow'
}
const RESULT_NOT_APPLIED = { text: 'Not applied', tagClass: 'govuk-tag--grey' }

const MODEL_VERBS = {
  add: { plain: 'Deploy', progressive: 'Deploying' },
  remove: { plain: 'Remove', progressive: 'Removing' }
}
const GENERIC_MODEL_VERB = { plain: 'Change', progressive: 'Changing' }

const FEDERATION_VERBS = {
  add: { plain: 'Federate', progressive: 'Federating' },
  change: { plain: 'Change', progressive: 'Changing' },
  remove: { plain: 'Remove', progressive: 'Removing' }
}

function timeOf(at) {
  return at ? formatDate(at, 'HH:mm') : null
}

function stepHint(step) {
  const time = timeOf(step.at)

  if (!time) {
    return undefined
  }

  if (step.status === 'current') {
    return `Started at ${time}`
  }

  return step.status === 'failed' ? `Failed at ${time}` : time
}

/**
 * The backend's steps as step list items: each with its time as the hint,
 * "Started at" for the one in progress and "Failed at" for the one that failed.
 * @param {Array<{label: string, status: string, at: string | null}> | undefined} steps
 * @returns {Array<{text: string, state: string, hint: string | undefined}>}
 */
export function buildOperationSteps(steps) {
  return (steps ?? []).map((step) => ({
    text: step.label,
    state: STEP_STATE[step.status] ?? 'waiting',
    hint: stepHint(step)
  }))
}

function limitsPhrase({ limits }, verb) {
  return `${verb} limits to ${numberFormat.format(limits.tokensPerMinute)} tokens and ${numberFormat.format(limits.requestsPerMinute)} requests a minute`
}

// The model changes grouped under their verb, in the order first seen:
// "Deploy A and B", "Remove C".
function modelPhrases(changes, modelNames, form) {
  const byVerb = new Map()

  for (const { change, modelSlug } of changes) {
    const verb = (MODEL_VERBS[change] ?? GENERIC_MODEL_VERB)[form]
    const names = byVerb.get(verb) ?? []

    names.push(modelNames[modelSlug] ?? modelSlug)
    byVerb.set(verb, names)
  }

  return [...byVerb].map(([verb, names]) => `${verb} ${joinNames(names)}`)
}

// An application change names the application and what is done to it; one the
// backend did not name is "applications".
function federationPhrase({ change, application }, form) {
  const verb = FEDERATION_VERBS[change]?.[form]

  return verb && application?.name
    ? `${verb} ${application.name}`
    : `${form === 'plain' ? 'Change' : 'Changing'} applications`
}

function phrasesOf(operation, modelNames, form) {
  const phrases = []
  const changes = operation.changes ?? []
  const verb = form === 'plain' ? 'Change' : 'Changing'
  const models = changes.filter(({ kind }) => kind === 'model')

  phrases.push(...modelPhrases(models, modelNames, form))

  for (const change of changes.filter(({ kind }) => kind !== 'model')) {
    if (change.kind === 'limits') {
      phrases.push(limitsPhrase(change, verb))
    } else {
      phrases.push(federationPhrase(change, form))
    }
  }

  if (phrases.length === 0 && operation.kind === 'revert') {
    return [
      form === 'plain'
        ? 'Put back the earlier version'
        : 'Putting back the earlier version'
    ]
  }

  return phrases.length === 0 ? [`${verb} this environment`] : phrases
}

// "Deploy A and change limits to ...": the first phrase keeps its capital, the
// rest start in lower case.
function joinPhrases(phrases) {
  return joinNames(
    phrases.map((phrase, index) =>
      index === 0 ? phrase : phrase.charAt(0).toLowerCase() + phrase.slice(1)
    )
  )
}

/**
 * What a change does, in two forms: "Deploy GPT-4o" for a list and
 * "Deploying GPT-4o" for a heading.
 * @param {{kind: string, changes: object[]}} operation
 * @param {Record<string, string>} modelNames - Display names by slug.
 * @returns {{plain: string, progressive: string}}
 */
export function describeChange(operation, modelNames) {
  return {
    plain: joinPhrases(phrasesOf(operation, modelNames, 'plain')),
    progressive: joinPhrases(phrasesOf(operation, modelNames, 'progressive'))
  }
}

function resultOf(operation, { failed, finished }) {
  if (failed) {
    return RESULT_FAILED
  }

  if (operation.open) {
    return RESULT_IN_PROGRESS
  }

  return finished ? RESULT_DONE : RESULT_NOT_APPLIED
}

function httpsOnly(url) {
  return typeof url === 'string' && url.startsWith('https://') ? url : null
}

function askedBy(operation) {
  // A name that is an address (sign-in fell back to the email) is masked as it
  // is for colleagues on the Members tab.
  const who = maskIfAddress(operation.requestedBy?.name)
  const time = timeOf(operation.createdAt)

  const byWho = who ? ` by ${who}` : ''
  const atTime = time ? ` at ${time}` : ''

  return `Asked for${byWho}${atTime}`
}

function stepText(operation) {
  const steps = operation.steps ?? []
  const current = steps.findIndex(({ status }) => status === 'current')

  return operation.open && current >= 0
    ? `Step ${current + 1} of ${steps.length}`
    : null
}

/**
 * One change as a page shows it.
 * @param {object} operation - An operation as the backend's team routes give it.
 * @param {{modelNames: Record<string, string>}} context
 * @returns {object}
 */
export function buildOperationItem(operation, { modelNames }) {
  const steps = operation.steps ?? []
  const failed = steps.some(({ status }) => status === 'failed')
  const finished = steps.length > 0 && steps.at(-1).status === 'done'
  const change = describeChange(operation, modelNames)
  const environmentName = environmentRegistryName(operation.environment)

  return {
    id: operation.id,
    environment: operation.environment,
    environmentName,
    change: change.plain,
    heading: `${change.progressive} in ${environmentName}`,
    askedBy: askedBy(operation),
    createdAt: operation.createdAt,
    stepText: stepText(operation),
    steps: buildOperationSteps(steps),
    result: resultOf(operation, { failed, finished }),
    failed,
    open: Boolean(operation.open),
    failure: failed
      ? {
          reason: operation.failureReason ?? null,
          runUrl: httpsOnly(operation.runUrl),
          reference: operation.supportReference ?? null
        }
      : null
  }
}

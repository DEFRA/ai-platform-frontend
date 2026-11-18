// What an environment's page and the pages that add a client secret show of
// the team's client secrets (B18), built from the backend's environment read:
// how many of the places are taken, each secret with its state and what a
// person can do about it. Nothing here reads the backend or the request. The
// backend never returns a value: a secret is shown once, when it is added.
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { environmentPageUrl } from '#/server/common/helpers/environment-names.js'
import { teamUrl } from '#/server/routes/teams/team-view.js'

const ACTIVE = 'active'
const EXPIRED = 'expired'
const DATE_FORMAT = 'd MMMM yyyy'

const TAGS = {
  [ACTIVE]: { text: 'Active', tagClass: 'govuk-tag--green' },
  [EXPIRED]: { text: 'Expired', tagClass: 'govuk-tag--grey' }
}

export const SECRET_STATE = {
  allowed: 'allowed',
  notAllowed: 'not-allowed',
  notSetUp: 'not-set-up'
}

/**
 * Where an admin confirms adding a client secret in an environment.
 * @param {string} teamSlug
 * @param {string} environment - The environment code.
 * @returns {string}
 */
export function clientSecretAddUrl(teamSlug, environment) {
  return `${environmentPageUrl(teamSlug, environment)}/client-secrets/add`
}

/**
 * Where the secret just added is shown, once.
 * @param {string} teamSlug
 * @param {string} environment - The environment code.
 * @returns {string}
 */
export function clientSecretAddedUrl(teamSlug, environment) {
  return `${environmentPageUrl(teamSlug, environment)}/client-secrets/added`
}

function expiryText(secret) {
  if (!secret.expiresAt) {
    return secret.status === EXPIRED ? null : 'Does not expire'
  }

  const date = formatDate(secret.expiresAt, DATE_FORMAT)

  return secret.status === EXPIRED ? `Expired ${date}` : `Expires ${date}`
}

// Only a secret still working can be viewed, rotated or revoked, and only by
// an admin; the pages behind the links decide it again. In a disabled
// environment viewing and rotating are plain text (no link): revoking stays.
function actionsFor(secret, { team, isAdmin, locked }) {
  if (!isAdmin || secret.status !== ACTIVE) {
    return []
  }

  const base = `${teamUrl(team)}/client-secrets/${encodeURIComponent(secret.id)}`

  return [
    { text: 'View', href: locked ? null : `${base}/view` },
    { text: 'Rotate', href: locked ? null : `${base}/rotate` },
    { text: 'Revoke', href: `${base}/revoke` }
  ]
}

function secretRow(secret, context) {
  const actions = actionsFor(secret, context)

  return {
    id: secret.id,
    // The row's title: the name an admin gave it with the end of the secret to
    // tell it from another of the same name, or the end alone.
    name: secret.name
      ? `${secret.name}, ends ${secret.keyHint}`
      : `Ends ${secret.keyHint}`,
    keyHint: secret.keyHint,
    tag: TAGS[secret.status] ?? TAGS[EXPIRED],
    expiryText: expiryText(secret),
    actions,
    askAnAdmin: !context.isAdmin && secret.status === ACTIVE
  }
}

/**
 * How full an environment's places for client secrets are: the secrets not
 * expired against the most it holds.
 * @param {{used: number, limit: number}} summary
 * @returns {{used: number, limit: number, countText: string, full: boolean}}
 */
export function secretCount({ used, limit }) {
  return {
    used,
    limit,
    countText: `${used} of ${limit} client secrets in use`,
    full: used >= limit
  }
}

function notAllowedSecrets(registryName, detail) {
  return {
    state: SECRET_STATE.notAllowed,
    message: `Client secrets are not available in ${registryName}. Applications there use a passwordless credential.`,
    applicationsHref:
      detail.setUp && detail.applications ? '#applications' : null,
    addUrl: null,
    items: []
  }
}

function notSetUpSecrets(registryName) {
  return {
    state: SECRET_STATE.notSetUp,
    message: `Deploy a model in ${registryName} first. You can add a client secret once it is set up.`,
    addUrl: null,
    items: []
  }
}

function allowedSecrets({
  team,
  environment,
  registryName,
  summary,
  isAdmin,
  locked
}) {
  const count = secretCount(summary)
  const context = { team, isAdmin, locked }
  const addable = isAdmin && !count.full

  return {
    state: SECRET_STATE.allowed,
    ...count,
    intro: `${count.countText}. Each lasts at most three months. Use one for local development; your deployed applications should use a passwordless credential.`,
    fullMessage: count.full
      ? `${registryName} holds ${summary.limit} client secrets, the most one environment can. Revoke one, or wait for one to expire, to add another.`
      : null,
    addUrl:
      addable && !locked ? clientSecretAddUrl(team.slug, environment) : null,
    addLocked: addable && locked,
    items: (summary.items ?? []).map((secret) => secretRow(secret, context))
  }
}

/**
 * The Client secrets section of an environment's page, or null when the
 * backend gave no read of them. Where they are not allowed the section says
 * where applications get a credential instead; where the environment is not
 * set up, that a model comes first.
 * @param {object} params
 * @param {{slug: string}} params.team
 * @param {string} params.environment - The environment code.
 * @param {string} params.registryName
 * @param {object} params.detail - The backend's environment read.
 * @param {boolean} params.isAdmin
 * @param {boolean} [params.locked] - The environment is disabled: nothing can be added, viewed or rotated.
 * @returns {object | null}
 */
export function buildClientSecrets({
  team,
  environment,
  registryName,
  detail,
  isAdmin,
  locked = false
}) {
  const summary = detail.clientSecrets

  if (!summary) {
    return null
  }

  if (!summary.allowed) {
    return notAllowedSecrets(registryName, detail)
  }

  if (!detail.setUp) {
    return notSetUpSecrets(registryName)
  }

  return allowedSecrets({
    team,
    environment,
    registryName,
    summary,
    isAdmin,
    locked
  })
}

/**
 * What the page that confirms adding a client secret says of where the team
 * stands, or the reason it cannot be added (the backend's code for it).
 * @param {object} detail - The backend's environment read.
 * @returns {{code: string | null, count?: object}}
 */
export function addableSecret(detail) {
  const summary = detail.clientSecrets

  if (!summary?.allowed) {
    return { code: 'client-secrets-not-allowed' }
  }

  if (!detail.setUp) {
    return { code: 'environment-not-set-up' }
  }

  const count = secretCount(summary)

  return count.full
    ? { code: 'credential-limit-reached', count }
    : { code: null, count }
}

/**
 * The page that shows a client secret that was just added, once: the value,
 * when it stops working and what to do next.
 * @param {object} params
 * @param {{slug: string, name: string}} params.team
 * @param {{environment: string, registryName: string}} params.environment
 * @param {{secret: string, credential: {keyHint: string, name?: string | null, expiresAt: string | null}}} params.issued
 * @param {boolean} params.placeholderCredential
 * @returns {object}
 */
export function buildAddedSecret({
  team,
  environment,
  issued,
  placeholderCredential
}) {
  const { credential, secret } = issued
  const returnHref = environmentPageUrl(team.slug, environment.environment)

  return {
    heading: 'Client secret added',
    caption: team.name,
    secret,
    placeholderCredential,
    environmentName: environment.registryName,
    name: credential.name ?? null,
    keyHint: credential.keyHint,
    expiresText: credential.expiresAt
      ? formatDate(credential.expiresAt, DATE_FORMAT)
      : 'Does not expire',
    expires: Boolean(credential.expiresAt),
    guidanceHref: `${returnHref}#client-secret-token`,
    applicationsHref: `${returnHref}#applications`,
    returnHref,
    returnText: `Back to ${environment.registryName}`
  }
}

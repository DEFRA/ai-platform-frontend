// What an environment's page shows of the team's applications and of how they
// connect, built from the backend's environment read: each application with
// its state and what an admin can do about it, and the connection details with
// the calls an application makes. Nothing here reads the backend or the request.
import {
  applicationUrl,
  federateUrl
} from '#/server/routes/environments/federation-urls.js'

const READY = 'ready'
const FAILED = 'failed'
const CHAT_COMPLETIONS = '/openai/v1/chat/completions'
const RESPONSES = '/openai/v1/responses'
const ACTIVE_STATUS = 'active'
const MODEL_PLACEHOLDER = '<model name>'
const BEARER = 'Authorization: Bearer <access token>'
const JSON_TYPE = 'Content-Type: application/json'
const JSON_INDENT = 2

const HOSTS = { cdp: 'CDP service', azure: 'Azure managed identity' }

const STATUS_TAGS = {
  'setting-up': { text: 'Setting up', tagClass: 'govuk-tag--yellow' },
  [READY]: { text: 'Ready to use', tagClass: 'govuk-tag--green' },
  removing: { text: 'Removing', tagClass: 'govuk-tag--yellow' },
  [FAILED]: { text: 'Failed', tagClass: 'govuk-tag--red' }
}

function tagFor(status) {
  return STATUS_TAGS[status] ?? { text: status, tagClass: 'govuk-tag--grey' }
}

// Only an admin changes or removes an application, because that can cut off a
// running service. An application being set up or removed is left alone until
// it settles; one that failed can only be cleared away.
function actionsFor(application, { team, environment, isAdmin }) {
  const { id, status } = application
  const url = (action) => applicationUrl(team.slug, environment, id, action)

  return {
    changeUrl: isAdmin && status === READY ? url('change') : null,
    removeUrl:
      isAdmin && (status === READY || status === FAILED) ? url('remove') : null
  }
}

function applicationRow(application, context) {
  return {
    id: application.id,
    name: application.name,
    kind: HOSTS[application.host] ?? application.host,
    tag: tagFor(application.status),
    reason:
      application.status === FAILED
        ? (application.failureReason ?? null)
        : null,
    ...actionsFor(application, context)
  }
}

/**
 * Whether an environment can take another application: it is set up and holds
 * fewer than its limit.
 * @param {{setUp?: boolean, applications?: {used: number, limit: number}} | undefined} summary
 * @returns {boolean}
 */
export function environmentHasRoom(summary) {
  const applications = summary?.applications

  return Boolean(
    summary?.setUp && applications && applications.used < applications.limit
  )
}

/**
 * The Applications section of an environment's page, or null where it has
 * none to show (the environment is not set up, or the backend gave no count).
 * @param {object} params
 * @param {{slug: string}} params.team
 * @param {string} params.environment - The environment code.
 * @param {string} params.registryName
 * @param {object} params.detail - The backend's environment read.
 * @param {boolean} params.isAdmin
 * @returns {object | null}
 */
export function buildApplications({
  team,
  environment,
  registryName,
  detail,
  isAdmin
}) {
  if (!detail.setUp || !detail.applications) {
    return null
  }

  const { used, limit, items = [] } = detail.applications
  const full = used >= limit
  const context = { team, environment, isAdmin }

  return {
    used,
    limit,
    countText: `${used} of ${limit} used`,
    full,
    fullMessage: full
      ? `${registryName} holds ${limit} applications, the most one environment can. Remove one to create another passwordless credential here.`
      : null,
    federateUrl: full ? null : federateUrl(team.slug, '', { environment }),
    items: items.map((application) => applicationRow(application, context))
  }
}

function pretty(value) {
  return JSON.stringify(value, null, JSON_INDENT)
}

// The first model the team can call: ready in this environment.
function firstReadyModel(detail) {
  return detail.models.find(({ status }) => status === ACTIVE_STATUS)?.modelSlug
}

// One form of call for each of the model's API profiles; no key and no
// api-version, because the team's API takes the access token alone.
function modelCall({ gatewayUrl }, model, apiProfile) {
  const name = model ?? MODEL_PLACEHOLDER
  const responses = apiProfile === 'responses'
  const body = responses
    ? { model: name, input: 'Hello' }
    : { model: name, messages: [{ role: 'user', content: 'Hello' }] }

  return [
    `POST ${gatewayUrl}${responses ? RESPONSES : CHAT_COMPLETIONS}`,
    BEARER,
    JSON_TYPE,
    '',
    pretty(body)
  ].join('\n')
}

function tokenRequest(connection) {
  return [
    `POST ${connection.tokenEndpoint}`,
    'Content-Type: application/x-www-form-urlencoded',
    '',
    'grant_type=client_credentials',
    `&client_id=${connection.clientId}`,
    `&scope=${connection.scope}`,
    '&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    '&client_assertion=<token from your CDP service>'
  ].join('\n')
}

const ROWS = [
  {
    id: 'gateway',
    key: 'Gateway address',
    label: 'gateway address',
    field: 'gatewayUrl'
  },
  {
    id: 'token-endpoint',
    key: 'Token endpoint',
    label: 'token endpoint',
    field: 'tokenEndpoint'
  },
  { id: 'client-id', key: 'Client ID', label: 'client ID', field: 'clientId' },
  { id: 'tenant-id', key: 'Tenant ID', label: 'tenant ID', field: 'tenantId' },
  { id: 'scope', key: 'Scope', label: 'scope', field: 'scope' },
  {
    id: 'audience',
    key: 'Audience',
    label: 'audience',
    hint: 'For a CDP token',
    field: 'cdpAudience'
  }
]

/**
 * The Connection details section: each value with its Copy, the first call
 * and how to get a token, for every member of the team. Null when the backend
 * has none for the environment.
 * @param {object} params
 * @param {object} params.detail - The backend's environment read.
 * @param {Record<string, {apiProfile?: string}>} params.catalogue - The catalogue's models by slug.
 * @returns {object | null}
 */
export function buildConnection({ detail, catalogue }) {
  const { connection } = detail

  if (!connection) {
    return null
  }

  const model = firstReadyModel(detail)
  const whoami = `GET ${connection.gatewayUrl}/whoami`

  return {
    placeholder: Boolean(connection.placeholder),
    rows: [
      ...ROWS.map(({ id, key, label, hint, field }) => ({
        id: `connection-${id}`,
        key,
        label,
        hint,
        value: connection[field]
      })),
      {
        id: 'connection-whoami',
        key: 'First test call',
        label: 'first test call',
        value: whoami
      }
    ],
    token: {
      audience: connection.cdpAudience,
      request: tokenRequest(connection),
      whoami: `${whoami}\n${BEARER}`,
      model: modelCall(connection, model, catalogue[model]?.apiProfile)
    }
  }
}

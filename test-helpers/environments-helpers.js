import { sampleTeam } from '#/test-helpers/team-connect-helpers.js'

/**
 * Fixtures for the Environments and deployments pages: what the backend's
 * team routes return (`GET /v1/teams/{team}/environments`, `.../environments/{env}`
 * and `.../operations`), so a test builds one and changes what it is about.
 */

export const TEAM_PATH = `/v1/teams/${sampleTeam.slug}`
export const OVERVIEW_URL = `/environments/${sampleTeam.slug}`
export const INFRADEV_URL = `${OVERVIEW_URL}/infradev`

const STEP_LABELS = [
  'Request received',
  'Checks passed',
  'Deploying',
  'Deployed',
  'Ready to use'
]
const TIMES = [
  '2026-11-12T10:41:00.000Z',
  '2026-11-12T10:42:00.000Z',
  '2026-11-12T10:42:30.000Z',
  '2026-11-12T10:43:00.000Z',
  '2026-11-12T10:44:00.000Z'
]

/**
 * The five steps, each with a status (`done`, `current`, `failed` or `todo`).
 * @param {string[]} statuses
 */
export function steps(statuses) {
  return STEP_LABELS.map((label, index) => ({
    key: label.toLowerCase().replaceAll(' ', '-'),
    label,
    status: statuses[index],
    at: statuses[index] === 'todo' ? null : TIMES[index]
  }))
}

/** An operation in progress: deploying GPT-4o in Infradev, at step 3. */
export function openOperation(overrides = {}) {
  return {
    id: 'op-open-12345',
    environment: 'infradev',
    kind: 'model',
    changes: [{ kind: 'model', change: 'add', modelSlug: 'gpt-4o' }],
    state: 'deploying',
    open: true,
    steps: steps(['done', 'done', 'current', 'todo', 'todo']),
    requestedBy: { name: 'Jo Bloggs' },
    createdAt: '2026-11-12T10:41:00.000Z',
    updatedAt: '2026-11-12T10:42:30.000Z',
    failureReason: null,
    runUrl: null,
    supportReference: 'AIP-12345',
    ...overrides
  }
}

/** An operation that finished: GPT-4o deployed. */
export function doneOperation(overrides = {}) {
  return openOperation({
    id: 'op-done-67890',
    state: 'active',
    open: false,
    steps: steps(['done', 'done', 'done', 'done', 'done']),
    supportReference: 'AIP-67890',
    ...overrides
  })
}

/** An operation that failed its checks. */
export function failedOperation(overrides = {}) {
  return openOperation({
    id: 'op-failed-24680',
    state: 'checks-failed',
    open: false,
    steps: steps(['done', 'failed', 'todo', 'todo', 'todo']),
    failureReason: 'The platform checks refused the change.',
    runUrl: 'https://github.com/DEFRA/ai-platform-tenants/actions/runs/42',
    supportReference: 'AIP-24680',
    ...overrides
  })
}

/** One environment as the backend lists it. */
export function summary(overrides = {}) {
  return {
    environment: 'infradev',
    setUp: true,
    paused: false,
    models: {
      count: 2,
      items: [
        { id: 'deployment-1', modelSlug: 'gpt-4o', status: 'active' },
        { id: 'deployment-2', modelSlug: 'gpt-4-1-nano', status: 'active' }
      ]
    },
    limits: { tokensPerMinute: 1000, requestsPerMinute: 60 },
    applications: { used: 0, limit: 20 },
    latestOperation: doneOperation(),
    inProgress: false,
    ...overrides
  }
}

/** One environment in full, as the backend gives it for its own page. */
export function detail(overrides = {}) {
  return {
    ...summary(),
    models: [
      {
        _id: 'deployment-1',
        teamId: 'team-1',
        modelSlug: 'gpt-4o',
        environment: 'infradev',
        status: 'active',
        activatedAt: '2026-11-10T09:00:00.000Z'
      },
      {
        _id: 'deployment-2',
        teamId: 'team-1',
        modelSlug: 'gpt-4-1-nano',
        environment: 'infradev',
        status: 'active',
        activatedAt: '2026-11-10T09:05:00.000Z'
      }
    ],
    limitBounds: {
      tokensPerMinute: { min: 1, max: 5000 },
      requestsPerMinute: { min: 1, max: 300 }
    },
    pendingLimits: null,
    ...overrides
  }
}

/**
 * One application as `applications.items` lists it: a CDP service federated
 * in Infradev and ready.
 */
export function federatedApplication(overrides = {}) {
  return {
    id: 'app-1',
    name: 'flood-api',
    host: 'cdp',
    service: 'flood-api',
    status: 'ready',
    operationId: 'op-fed-1',
    failureReason: null,
    ...overrides
  }
}

/** The placeholder connection details the backend gives under the mock. */
export const connectionDetails = {
  placeholder: true,
  gatewayUrl: 'https://gateway.example/flood-risk-team',
  tokenEndpoint:
    'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/oauth2/v2.0/token',
  clientId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000000',
  scope: 'api://00000000-0000-0000-0000-000000000002/.default',
  cdpAudience: 'api://AzureADTokenExchange'
}

/** The applications part of an environment read. */
export function applicationsOf(items, used = items.length) {
  return { used, limit: 20, items }
}

/** The environments read for the sample team. */
export function environmentsRead(environments = [summary()]) {
  return {
    team: { id: 'team-1', slug: sampleTeam.slug, name: sampleTeam.name },
    environments
  }
}

/**
 * The backend's team operations route answering by `status`.
 * @param {{open?: object[], recent?: object[]}} operations
 */
export function operationsAnswer({ open = [], recent = [] } = {}) {
  return (request) => {
    const status = new URL(request.url).searchParams.get('status')

    return { items: status === 'open' ? open : recent }
  }
}

/** The team's own credential for Infradev, as `GET /v1/credentials` lists it. */
export const teamCredential = {
  _id: 'cred-1',
  tier: 'team',
  teamId: 'team-1',
  environment: 'infradev',
  status: 'active',
  expiresAt: '2027-10-19T00:00:00.000Z',
  createdAt: '2026-10-21T10:45:00.000Z'
}

import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  FEDERATE_URL,
  FEDERATIONS_PATH,
  dryRun,
  queued
} from '#/test-helpers/federation-helpers.js'
import {
  OVERVIEW_URL,
  INFRADEV_URL,
  TEAM_PATH,
  detail,
  doneOperation,
  environmentsRead,
  failedOperation,
  openOperation,
  operationsAnswer,
  steps
} from '#/test-helpers/environments-helpers.js'
import {
  signInViaOidc,
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
  sampleModel,
  sampleTeam,
  teamWithMembers
} from '#/test-helpers/team-connect-helpers.js'

vi.mock('#/server/common/helpers/oidc-client.js', () => ({
  getOidcConfig: vi.fn().mockResolvedValue('fake-oidc-config')
}))

vi.mock('openid-client', () => ({
  randomPKCECodeVerifier: vi.fn(() => 'verifier'),
  calculatePKCECodeChallenge: vi.fn(async () => 'challenge'),
  randomState: vi.fn(() => 'state-123'),
  randomNonce: vi.fn(() => 'nonce-123'),
  buildAuthorizationUrl: vi.fn(
    () =>
      new URL(
        'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=state-123'
      )
  ),
  authorizationCodeGrant: vi.fn(async () => ({
    access_token: 'user-access-token',
    refresh_token: 'user-refresh-token',
    expires_in: 3600,
    claims: () => ({
      preferred_username: 'test.user@defra.gov.uk',
      email: 'test.user@defra.gov.uk',
      name: 'Test User'
    })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const PROGRESS_URL = `${FEDERATE_URL}/progress`
const CHECK_PATH = `${FEDERATIONS_PATH}/check`
const FEDERATION_CHANGE = {
  kind: 'federation',
  change: 'add',
  application: { name: 'flood-api', host: 'cdp', service: 'flood-api' }
}

const FEDERATION_LABELS = [
  'Request received',
  'Checks passed',
  'Adding to your team’s registration',
  'Verified',
  'Ready to use'
]

// A federation's operation in one environment, at the given step statuses.
function federationOperation(environment, statuses, overrides = {}) {
  return {
    ...openOperation({
      id: `op-${environment}`,
      environment,
      kind: 'federation',
      changes: [FEDERATION_CHANGE]
    }),
    steps: steps(statuses).map((step, index) => ({
      ...step,
      label: FEDERATION_LABELS[index]
    })),
    ...overrides
  }
}

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('the page that follows a federation', () => {
  let server
  let cookies
  const configured = config.get('teamEnvironments')

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    config.set('teamEnvironments', configured)
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    fetchMock.resetMocks()
    config.set('teamEnvironments', ['infradev', 'qa'])
    cookies = await signInViaOidc(server, fetchMock)
  })

  function backend(routes = {}, role = 'admin') {
    mockApi(fetchMock, {
      'GET /v1/teams': { items: [sampleTeam] },
      'GET /v1/models': { items: [sampleModel] },
      'GET /v1/credentials': { items: [] },
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${TEAM_PATH}/environments`]: environmentsRead(),
      [`GET ${TEAM_PATH}/environments/infradev`]: detail(),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      [`POST ${CHECK_PATH}`]: dryRun(),
      [`POST ${FEDERATIONS_PATH}`]: queued(),
      ...routes
    })
  }

  async function send(method, url, payload) {
    const response = await server.inject({
      method,
      url,
      headers: { cookie: cookieHeader(cookies) },
      ...(payload && { payload: { crumb: cookies.crumb, ...payload } })
    })

    cookies = mergeCookies(cookies, response)

    return { response, $: load(response.result ?? '') }
  }

  // Federates flood-api in the environments, as a person would.
  async function federated(environments = ['infradev', 'qa']) {
    await send('POST', FEDERATE_URL, { host: 'cdp' })
    await send('POST', `${FEDERATE_URL}/service`, { service: 'flood-api' })
    await send('POST', `${FEDERATE_URL}/environments`, { environments })

    const { $ } = await send('GET', `${FEDERATE_URL}/check`)

    return send('POST', `${FEDERATE_URL}/check`, {
      key: $('input[name="key"]').attr('value')
    })
  }

  function operationRoutes(operations) {
    return Object.fromEntries(
      operations.map((operation) => [
        `GET ${TEAM_PATH}/operations/${operation.id}`,
        operation
      ])
    )
  }

  test('sends a person who has not just federated anything to the overview', async () => {
    backend()

    const { response } = await send('GET', PROGRESS_URL)

    expect(response.statusCode).toBe(statusCodes.seeOther)
    expect(response.headers.location).toBe(OVERVIEW_URL)
  })

  test('shows a step list for each environment asked for, in a polite live region, with Check progress (AC14)', async () => {
    backend(
      operationRoutes([
        federationOperation('infradev', [
          'done',
          'done',
          'current',
          'todo',
          'todo'
        ]),
        federationOperation('qa', ['done', 'current', 'todo', 'todo', 'todo'])
      ])
    )
    await federated()

    const { response, $ } = await send('GET', PROGRESS_URL)

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(text($, 'h1')).toBe(
      'Creating a passwordless credential for flood-api'
    )
    expect($('[data-testid="app-heading-caption"]').text()).toBe(
      'Flood Risk Team'
    )
    expect(
      $('[aria-live="polite"][data-progress-refresh]').attr(
        'data-progress-refresh'
      )
    ).toBe(`${PROGRESS_URL}?fragment=status`)
    expect($('[data-in-progress]').attr('data-in-progress')).toBe('true')
    expect(
      $('[data-testid="federate-environment"] h2')
        .map((_, el) => $(el).text())
        .get()
    ).toEqual(['Infradev', 'QA'])
    expect($('[data-testid="step-list"]')).toHaveLength(2)
    expect(
      $('[data-testid="step-list"]')
        .first()
        .find('[data-testid="step-list-item"]')
        .map((_, el) =>
          $(el).find('.app-step-list__label').text().replace(/\s+/g, ' ').trim()
        )
        .get()
    ).toEqual([
      'Done: Request received',
      'Done: Checks passed',
      'In progress: Adding to your team’s registration',
      'Not started: Verified',
      'Not started: Ready to use'
    ])
    expect(text($, '[data-testid="check-progress"]')).toBe('Check progress')
    expect($('[data-testid="check-progress"]').attr('href')).toBe(PROGRESS_URL)
  })

  test('reads each environment’s own operation, only that team’s', async () => {
    backend(
      operationRoutes([
        federationOperation('infradev', [
          'done',
          'current',
          'todo',
          'todo',
          'todo'
        ]),
        federationOperation('qa', ['done', 'current', 'todo', 'todo', 'todo'])
      ])
    )
    await federated()
    fetchMock.mockClear()

    await send('GET', PROGRESS_URL)

    const paths = fetchMock.mock.calls
      .map(([url]) => new URL(url).pathname)
      .filter((path) => path.includes('/operations/'))

    expect(paths.sort()).toEqual([
      `${TEAM_PATH}/operations/op-infradev`,
      `${TEAM_PATH}/operations/op-qa`
    ])
  })

  test('is the status on its own at ?fragment=status, never cached, saying whether anything is in progress', async () => {
    backend(
      operationRoutes([
        federationOperation('infradev', [
          'done',
          'current',
          'todo',
          'todo',
          'todo'
        ]),
        federationOperation('qa', ['done', 'done', 'done', 'done', 'done'], {
          open: false
        })
      ])
    )
    await federated()

    const { response, $ } = await send('GET', `${PROGRESS_URL}?fragment=status`)

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers.etag).toBeDefined()
    expect($('[data-in-progress]').attr('data-in-progress')).toBe('true')
    expect($('h1')).toHaveLength(0)
  })

  test('confirms every environment is ready with a link to each one’s connection details and how to get a token (AC13)', async () => {
    const done = ['done', 'done', 'done', 'done', 'done']

    backend(
      operationRoutes([
        federationOperation('infradev', done, { open: false, state: 'active' }),
        federationOperation('qa', done, { open: false, state: 'active' })
      ])
    )
    await federated()

    const { $ } = await send('GET', PROGRESS_URL)

    expect(text($, '[data-testid="federated-panel"]')).toBe(
      'flood-api has a passwordless credential in Infradev and QA'
    )
    expect(text($, 'main h2')).toBe('Connect flood-api')
    expect(
      $('[data-testid="connect-links"] a')
        .map((_, el) => [[$(el).text(), $(el).attr('href')]])
        .get()
    ).toEqual([
      ['Connection details for Infradev', `${INFRADEV_URL}#connection-details`],
      [
        'How flood-api gets a token in Infradev',
        `${INFRADEV_URL}#how-to-get-a-token`
      ],
      ['Connection details for QA', `${OVERVIEW_URL}/qa#connection-details`],
      [
        'How flood-api gets a token in QA',
        `${OVERVIEW_URL}/qa#how-to-get-a-token`
      ]
    ])
  })

  test('shows why one environment failed and that the other is ready, so a failure in one leaves the other unchanged (AC14)', async () => {
    backend(
      operationRoutes([
        federationOperation(
          'infradev',
          ['done', 'done', 'done', 'done', 'done'],
          {
            open: false,
            state: 'active'
          }
        ),
        {
          ...failedOperation({
            id: 'op-qa',
            environment: 'qa',
            kind: 'federation',
            changes: [FEDERATION_CHANGE]
          })
        }
      ])
    )
    await federated()

    const { $ } = await send('GET', PROGRESS_URL)

    expect(text($, 'h1')).toBe(
      'We could not create a passwordless credential for flood-api everywhere'
    )
    expect($('[data-in-progress]').attr('data-in-progress')).toBe('false')
    expect(text($, '[data-testid="failure"]')).toContain(
      'The platform checks refused the change.'
    )
    expect($('[data-testid="failure"] a').attr('href')).toBe(
      'https://github.com/DEFRA/ai-platform-tenants/actions/runs/42'
    )
    expect($('[data-testid="federate-environment"]')).toHaveLength(2)
    expect(text($, '[data-testid="check-progress"]')).toBe('See the result')
    expect($('[data-testid="federated-panel"]')).toHaveLength(0)
  })

  test('is a 404 for the status on its own when the backend does not know the operation, and an error for an answer it does not know', async () => {
    backend({
      ...operationRoutes([
        federationOperation('infradev', [
          'done',
          'current',
          'todo',
          'todo',
          'todo'
        ])
      ]),
      [`GET ${TEAM_PATH}/operations/op-qa`]: reply(404, { code: 'error' })
    })
    await federated()

    const fragment = await send('GET', `${PROGRESS_URL}?fragment=status`)

    expect(fragment.response.statusCode).toBe(statusCodes.notFound)

    backend({
      [`GET ${TEAM_PATH}/operations/op-infradev`]: reply(400, {
        code: 'something-new'
      }),
      [`GET ${TEAM_PATH}/operations/op-qa`]: reply(400, {
        code: 'something-new'
      })
    })

    const unknown = await send('GET', PROGRESS_URL)

    expect(unknown.response.statusCode).toBe(statusCodes.internalServerError)
  })

  test('is a 404 when the backend does not know the operation', async () => {
    backend({
      ...operationRoutes([
        federationOperation('infradev', [
          'done',
          'current',
          'todo',
          'todo',
          'todo'
        ])
      ]),
      [`GET ${TEAM_PATH}/operations/op-qa`]: reply(404, { code: 'error' })
    })
    await federated()

    const { response } = await send('GET', PROGRESS_URL)

    expect(response.statusCode).toBe(statusCodes.notFound)
  })

  test('says it could not read how it is going when the backend fails, and the fragment answers 503 so the page keeps what it has', async () => {
    backend({
      [`GET ${TEAM_PATH}/operations/op-infradev`]: reply(502, {
        code: 'upstream-unavailable'
      }),
      [`GET ${TEAM_PATH}/operations/op-qa`]: reply(502, {
        code: 'upstream-unavailable'
      })
    })
    await federated()

    const page = await send('GET', PROGRESS_URL)
    const fragment = await send('GET', `${PROGRESS_URL}?fragment=status`)

    expect(page.response.statusCode).toBe(statusCodes.serviceUnavailable)
    expect(text(page.$, 'h1')).toBe('Applications are not available just now')
    expect(fragment.response.statusCode).toBe(statusCodes.serviceUnavailable)
  })

  test('is not another team’s: a journey for one team is not shown under another', async () => {
    backend(
      operationRoutes([
        federationOperation('infradev', [
          'done',
          'current',
          'todo',
          'todo',
          'todo'
        ]),
        federationOperation('qa', ['done', 'current', 'todo', 'todo', 'todo'])
      ])
    )
    await federated()
    backend({
      ...operationRoutes([doneOperation()]),
      'GET /v1/teams/coastal-team': teamWithMembers('admin', {
        ...sampleTeam,
        slug: 'coastal-team'
      })
    })

    const { response } = await send(
      'GET',
      '/environments/coastal-team/federate/progress'
    )

    expect(response.headers.location).toBe('/environments/coastal-team')
  })
})

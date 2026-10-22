import {
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'

/**
 * Shared fixtures and steps for tests that drive the team connect journey
 * and its wait page through `server.inject`, with the backend mocked on
 * `fetchMock` in call order.
 */

export const sampleTeam = {
  _id: 'team-1',
  slug: 'flood-risk-team',
  name: 'Flood Risk Team',
  role: 'admin',
  createdAt: '2020-01-01T09:00:00.000Z'
}

export const sampleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai',
  description: 'Multimodal OpenAI model.',
  useCases: ['Chat assistants', 'Summarising documents'],
  eligible: true,
  researchAvailable: true,
  tiers: ['research', 'team'],
  regions: ['uksouth'],
  skus: [{ name: 'DataZoneStandard', tiers: ['team'] }],
  deploymentName: 'gpt-4o',
  apiVersion: '2024-05-01-preview',
  limitsDefault: { requestsPerMinute: 60 }
}

export const nanoModel = {
  ...sampleModel,
  slug: 'gpt-4-1-nano',
  displayName: 'GPT-4.1 nano',
  description: 'A small, fast model.',
  useCases: ['Classifying text'],
  deploymentName: 'gpt-4-1-nano'
}

// Offered to teams, but only in a US region.
export const abroadModel = {
  ...sampleModel,
  slug: 'gpt-5-mini',
  displayName: 'GPT-5 mini',
  regions: ['eastus']
}

// Offered to teams only as a worldwide SKU, which is never usable, even in a
// UK region.
export const worldwideModel = {
  ...sampleModel,
  slug: 'gpt-5-nano',
  displayName: 'GPT-5 nano',
  skus: [{ name: 'GlobalStandard', tiers: ['team'] }]
}

// Runs in Sweden Central, which is allowed.
export const swedenModel = {
  ...sampleModel,
  slug: 'gpt-4-1-mini',
  displayName: 'GPT-4.1 mini',
  regions: ['swedencentral']
}

// The team as the backend returns it with its members, the signed-in test
// user being an admin of it, a member of it, or neither.
export function teamWithMembers(role = 'admin', team = sampleTeam) {
  return {
    team,
    members: role
      ? [
          { _id: 'member-1', userId: 'user-1', role, status: 'active' },
          { _id: 'member-2', userId: 'user-2', role: 'admin', status: 'active' }
        ]
      : [{ _id: 'member-2', userId: 'user-2', role: 'admin', status: 'active' }]
  }
}

/**
 * @param {import('vitest-fetch-mock').FetchMock} fetchMock
 */
export function teamConnectHelpers(fetchMock) {
  function mockResponse(body, init) {
    fetchMock.mockResponseOnce(JSON.stringify(body), init)
  }

  // What the team step reads: the person's teams, each team's deployments,
  // and the catalogue for the names when any team has a model.
  function mockTeamChoices({
    teams = [sampleTeam],
    deployments = teams.map(() => []),
    models = [sampleModel, nanoModel]
  } = {}) {
    mockResponse({ items: teams })

    for (const items of deployments) {
      mockResponse({ items })
    }

    if (deployments.some((items) => items.length > 0)) {
      mockResponse({ items: models })
    }
  }

  // What the model step reads: the team-tier catalogue for the environment,
  // the whole catalogue (for the models not in the UK yet), then the team's
  // own deployments (a model it already has cannot be chosen again).
  function mockModelChoices({
    models = [sampleModel],
    catalogue = models,
    deployments = []
  } = {}) {
    mockResponse({ items: models })
    mockResponse({ items: catalogue })
    mockResponse({ items: deployments })
  }

  function post(server, cookies, url, payload, headers = {}) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: cookieHeader(cookies), ...headers },
      payload: { crumb: cookies.crumb, ...payload }
    })
  }

  function get(server, cookies, url) {
    return server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
    })
  }

  // Starts a team journey the way Add to a team does, carrying the model it
  // was pressed on when there is one, and chooses the sample team.
  async function reachTeamStep(server, cookies, { modelSlug } = {}) {
    const query = modelSlug ? `?modelSlug=${modelSlug}` : ''

    cookies = mergeCookies(
      cookies,
      await get(server, cookies, `/connect/team/start${query}`)
    )
    mockResponse(teamWithMembers())

    return mergeCookies(
      cookies,
      await post(server, cookies, '/connect/team/select', {
        team: sampleTeam.slug
      })
    )
  }

  // Through the team and model steps to the details step.
  async function reachDetails(server, cookies, modelSlugs = ['gpt-4o']) {
    cookies = await reachTeamStep(server, cookies)
    mockModelChoices({ models: [sampleModel, nanoModel] })

    return mergeCookies(
      cookies,
      await post(server, cookies, '/connect/team/model', { modelSlugs })
    )
  }

  async function reachCheckStep(server, cookies, modelSlugs) {
    cookies = await reachDetails(server, cookies, modelSlugs)

    return mergeCookies(
      cookies,
      await post(server, cookies, '/connect/team/details', {
        purpose: 'Journey test'
      })
    )
  }

  // Through the journey to the confirmed request, which the backend answers
  // with `deployments`; the session then remembers them for the wait page.
  async function makeRequest(server, cookies, modelSlugs, deployments) {
    cookies = await reachCheckStep(server, cookies, modelSlugs)
    mockResponse({ deployments })

    return mergeCookies(
      cookies,
      await post(server, cookies, '/connect/team/check', {})
    )
  }

  function lastRequest() {
    const [url, init] = fetchMock.mock.calls.at(-1)

    return { url, init, body: init.body ? JSON.parse(init.body) : undefined }
  }

  return {
    mockResponse,
    mockTeamChoices,
    mockModelChoices,
    post,
    get,
    reachTeamStep,
    reachDetails,
    reachCheckStep,
    makeRequest,
    lastRequest
  }
}

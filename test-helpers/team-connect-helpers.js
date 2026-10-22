import {
  mergeCookies,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'

/**
 * Shared fixtures and steps for tests that drive the team connect journey
 * and its wait page through `server.inject`, with the backend mocked on
 * `fetchMock` in call order.
 */

export const sampleTeam = { _id: 'team-1', name: 'Flood Risk Team' }

export const sampleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai',
  description: 'Multimodal OpenAI model.',
  deploymentName: 'gpt-4o',
  apiVersion: '2024-05-01-preview',
  limitsDefault: { requestsPerMinute: 60 }
}

export const nanoModel = {
  ...sampleModel,
  slug: 'gpt-4-1-nano',
  displayName: 'GPT-4.1 nano',
  description: 'A small, fast model.',
  deploymentName: 'gpt-4-1-nano'
}

/**
 * @param {import('vitest-fetch-mock').FetchMock} fetchMock
 */
export function teamConnectHelpers(fetchMock) {
  function mockResponse(body, init) {
    fetchMock.mockResponseOnce(JSON.stringify(body), init)
  }

  // What the model step reads: the team-tier catalogue, then the team's own
  // deployments (a model it already has cannot be chosen again).
  function mockModelChoices({ models = [sampleModel], deployments = [] } = {}) {
    mockResponse({ items: models })
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
  // was pressed on when there is one.
  async function reachTeamStep(server, cookies, { modelSlug } = {}) {
    const query = modelSlug ? `?modelSlug=${modelSlug}` : ''

    cookies = mergeCookies(
      cookies,
      await get(server, cookies, `/connect/team/start${query}`)
    )
    mockResponse({ items: [sampleTeam] })
    cookies = mergeCookies(
      cookies,
      await get(server, cookies, '/connect/team/select')
    )

    return mergeCookies(
      cookies,
      await post(server, cookies, '/connect/team/select', { teamId: 'team-1' })
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

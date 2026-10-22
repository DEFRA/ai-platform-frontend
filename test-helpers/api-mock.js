/**
 * Answers the backend by method and path rather than in call order, for pages
 * that read several things at once. Routes are keyed `'GET /v1/teams/x'`; a
 * value is the JSON body, or `reply(status, body)` for another status, or a
 * function of the request returning either. A path nobody answered is a 404.
 *
 * Call it after sign-in: anything queued with `mockResponseOnce` is used first.
 * @param {import('vitest-fetch-mock').FetchMock} fetchMock
 * @param {Record<string, unknown>} routes
 */
export function mockApi(fetchMock, routes) {
  fetchMock.mockResponse(async (request) => {
    const { pathname, search } = new URL(request.url)
    const key = [
      `${request.method} ${pathname}${search}`,
      `${request.method} ${pathname}`
    ].find((candidate) => candidate in routes)
    const answer =
      typeof routes[key] === 'function'
        ? await routes[key](request)
        : routes[key]

    if (key === undefined) {
      return reply(404, { code: 'not-found', message: 'Not Found' }).init()
    }

    return answer instanceof Reply
      ? answer.init()
      : { body: JSON.stringify(answer) }
  })
}

class Reply {
  constructor(status, body) {
    this.status = status
    this.body = body
  }

  init() {
    return this.body === undefined
      ? { status: this.status }
      : { status: this.status, body: JSON.stringify(this.body) }
  }
}

/**
 * A backend answer with a status other than 200.
 * @param {number} status
 * @param {unknown} [body]
 */
export function reply(status, body) {
  return new Reply(status, body)
}

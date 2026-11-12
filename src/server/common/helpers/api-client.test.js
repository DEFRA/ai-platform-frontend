import createFetchMock from 'vitest-fetch-mock'

import { apiClient, ApiError } from './api-client.js'
import { wasUnauthorised } from './api-error.js'
import { getAppToken, getUserToken } from './access-token.js'

vi.mock('./access-token.js', () => ({
  getUserToken: vi.fn(async () => 'user-token'),
  getAppToken: vi.fn(async () => 'app-token')
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const signedIn = () => ({
  headers: {},
  yar: { get: () => ({ accessToken: 'session-access-token' }) }
})
const signedOut = () => ({ headers: {}, yar: { get: () => undefined } })

describe('#apiClient', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  test('get() resolves with the parsed JSON body on success', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const result = await apiClient(signedOut()).get('/v1/models')

    expect(result).toEqual({ items: [] })
  })

  test('put() sends no body when it is given none', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ user: {} }))

    await apiClient(signedIn()).put('/v1/users/me')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('PUT')
    expect(init.body).toBeUndefined()
  })

  test('put() sends a JSON body and the Idempotency-Key header it is given', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ operation: { id: 'op-1' } }))

    await apiClient(signedIn()).put(
      '/v1/teams/flood/environments/infradev/limits',
      { tokensPerMinute: 2000, requestsPerMinute: 120 },
      { idempotencyKey: 'key-1' }
    )

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      tokensPerMinute: 2000,
      requestsPerMinute: 120
    })
    expect(fetchMock.requests()[0].headers.get('idempotency-key')).toBe('key-1')
  })

  describe('who the call is for', () => {
    test("sends the signed-in person's access token as a bearer token", async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
      const request = signedIn()

      await apiClient(request).get('/v1/credentials')

      expect(getUserToken).toHaveBeenCalledWith(request)
      expect(getAppToken).not.toHaveBeenCalled()
      expect(fetchMock.requests()[0].headers.get('authorization')).toBe(
        'Bearer user-token'
      )
    })

    test("sends the frontend's own app token before anyone has signed in", async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

      await apiClient(signedOut()).get('/v1/models')

      expect(getAppToken).toHaveBeenCalledTimes(1)
      expect(getUserToken).not.toHaveBeenCalled()
      expect(fetchMock.requests()[0].headers.get('authorization')).toBe(
        'Bearer app-token'
      )
    })

    test('never sends who the person is as a header, even if a caller still passes a user id', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}))

      await apiClient(signedIn()).get('/v1/credentials', { userId: 'user-1' })

      expect(fetchMock.requests()[0].headers.get('x-user-id')).toBeNull()
    })

    test('does not call the backend when no token can be had', async () => {
      getUserToken.mockRejectedValueOnce(
        new ApiError({ statusCode: 401, code: 'token-refresh-failed' })
      )

      await expect(
        apiClient(signedIn()).get('/v1/credentials')
      ).rejects.toMatchObject({ statusCode: 401, code: 'token-refresh-failed' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    test('does not call the backend when the frontend token cannot be had', async () => {
      getAppToken.mockRejectedValueOnce(
        new ApiError({ statusCode: 502, code: 'upstream-unavailable' })
      )

      await expect(
        apiClient(signedOut()).get('/v1/models')
      ).rejects.toMatchObject({ statusCode: 502 })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    test('works for a request with no session at all', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}))

      await apiClient({ headers: {} }).get('/v1/models')

      expect(fetchMock.requests()[0].headers.get('authorization')).toBe(
        'Bearer app-token'
      )
    })

    test('never falls back to the app identity for a person who is signed in but has no tokens (a session from before tokens were kept)', async () => {
      getUserToken.mockRejectedValueOnce(
        new ApiError({ statusCode: 401, code: 'not-signed-in' })
      )
      const request = {
        headers: {},
        yar: { get: (key) => (key === 'user' ? { id: 'user-1' } : undefined) }
      }

      await expect(
        apiClient(request).get('/v1/credentials')
      ).rejects.toMatchObject({ statusCode: 401 })

      expect(getUserToken).toHaveBeenCalledWith(request)
      expect(getAppToken).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('noting that the session is no good', () => {
    const withApp = (request) => ({ ...request, app: {} })

    test('notes it on the request when no token can be had for a signed-in person', async () => {
      getUserToken.mockRejectedValueOnce(
        new ApiError({ statusCode: 401, code: 'token-refresh-failed' })
      )
      const request = withApp(signedIn())

      await apiClient(request)
        .get('/v1/credentials')
        .catch(() => {})

      expect(wasUnauthorised(request)).toBe(true)
    })

    test('notes it on the request when the backend answers 401', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ code: 'invalid-token' }), {
        status: 401
      })
      const request = withApp(signedIn())

      await apiClient(request)
        .get('/v1/credentials')
        .catch(() => {})

      expect(wasUnauthorised(request)).toBe(true)
    })

    test.each([403, 404, 500])('does not note it for a %s', async (status) => {
      fetchMock.mockResponseOnce(JSON.stringify({ code: 'x' }), { status })
      const request = withApp(signedIn())

      await apiClient(request)
        .get('/v1/credentials')
        .catch(() => {})

      expect(wasUnauthorised(request)).toBe(false)
    })

    test('does not note it when the frontend token cannot be had (502, not a refused session)', async () => {
      getAppToken.mockRejectedValueOnce(
        new ApiError({ statusCode: 502, code: 'upstream-unavailable' })
      )
      const request = withApp(signedOut())

      await apiClient(request)
        .get('/v1/models')
        .catch(() => {})

      expect(wasUnauthorised(request)).toBe(false)
    })
  })

  test('forwards the CDP tracing header', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({}))

    await apiClient({
      ...signedOut(),
      headers: { 'x-cdp-request-id': 'trace-1' }
    }).get('/v1/models')

    expect(fetchMock.requests()[0].headers.get('x-cdp-request-id')).toBe(
      'trace-1'
    )
  })

  test('post() throws an ApiError with the backend code on a non-2xx response', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        message: 'Model is not eligible',
        code: 'model-not-eligible'
      }),
      { status: 400 }
    )

    await expect(
      apiClient(signedIn()).post('/v1/credentials', { modelSlug: 'x' })
    ).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 400,
      code: 'model-not-eligible'
    })
  })

  test('an invalid-token answer is an ApiError the error handler can send to sign in', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ code: 'invalid-token', message: 'Unauthorized' }),
      { status: 401 }
    )

    await expect(
      apiClient(signedIn()).get('/v1/credentials')
    ).rejects.toMatchObject({ statusCode: 401, code: 'invalid-token' })
  })

  test('post() carries extra backend error fields (e.g. existingId) onto the ApiError', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        message: 'A deployment already exists',
        code: 'deployment-exists',
        existingId: 'deployment-1'
      }),
      { status: 409 }
    )

    await expect(
      apiClient(signedIn()).post('/v1/teams/team-1/deployments', {
        modelSlug: 'x'
      })
    ).rejects.toMatchObject({
      code: 'deployment-exists',
      existingId: 'deployment-1'
    })
  })

  test('throws an ApiError when the network request itself fails', async () => {
    fetchMock.mockRejectOnce(new Error('network down'))

    await expect(
      apiClient(signedOut()).get('/v1/models')
    ).rejects.toBeInstanceOf(ApiError)
  })
})

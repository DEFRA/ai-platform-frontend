import createFetchMock from 'vitest-fetch-mock'

import { apiClient, ApiError } from './api-client.js'

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

describe('#apiClient', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  test('get() resolves with the parsed JSON body on success', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const result = await apiClient({ headers: {} }).get('/v1/models')

    expect(result).toEqual({ items: [] })
  })

  test('get() forwards the x-user-id header when provided', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    await apiClient({ headers: {} }).get('/v1/credentials', {
      userId: 'user-1'
    })

    expect(fetchMock.requests()[0].headers.get('x-user-id')).toBe('user-1')
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
      apiClient({ headers: {} }).post('/v1/credentials', { modelSlug: 'x' })
    ).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 400,
      code: 'model-not-eligible'
    })
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
      apiClient({ headers: {} }).post('/v1/teams/team-1/deployments', {
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
      apiClient({ headers: {} }).get('/v1/models')
    ).rejects.toBeInstanceOf(ApiError)
  })
})

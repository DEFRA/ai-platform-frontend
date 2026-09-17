import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { extractCookie } from '#/test-helpers/session-helpers.js'

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

describe('#signInController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    fetchMock.resetMocks()
  })

  test('GET /sign-in renders the sign-in form', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/sign-in'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Sign in'))
  })

  test('POST /sign-in with missing fields re-renders the form with errors', async () => {
    const getResponse = await server.inject({ method: 'GET', url: '/sign-in' })
    const crumb = extractCookie(getResponse, 'crumb')

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/sign-in',
      headers: { cookie: `crumb=${crumb}` },
      payload: { crumb }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('POST /sign-in with a valid payload signs the user in and redirects', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        user: {
          _id: 'user-1',
          email: 'test.user@defra.gov.uk',
          displayName: 'Test User'
        },
        team: { _id: 'team-1', name: 'Platform Team' }
      })
    )

    const getResponse = await server.inject({ method: 'GET', url: '/sign-in' })
    const crumb = extractCookie(getResponse, 'crumb')

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/sign-in',
      headers: { cookie: `crumb=${crumb}` },
      payload: {
        crumb,
        email: 'test.user@defra.gov.uk',
        displayName: 'Test User',
        teamName: 'Platform Team'
      }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/connect-model')
  })
})

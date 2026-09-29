import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'

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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

describe('#homeController', () => {
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

  test('Should provide expected response when signed out', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(result).toEqual(expect.stringContaining('Home |'))
    expect(result).toEqual(expect.stringContaining('Start now'))
    expect(statusCode).toBe(statusCodes.ok)
  })

  test('Should show a renewal banner for a key expiring soon when signed in', async () => {
    const cookies = await signInViaOidc(server, fetchMock)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'cred-1',
            tier: 'research',
            status: 'active',
            expiresAt: '2026-10-01T00:00:00.000Z'
          }
        ]
      })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Renew your key'))
    expect(result).toEqual(expect.stringContaining('Browse models'))
  })

  test('Should show team access when signed in with an active team key', async () => {
    const cookies = await signInViaOidc(server, fetchMock)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'cred-team-1',
            tier: 'team',
            teamId: 'team-1',
            status: 'active',
            allowedDeployments: ['gpt-4o']
          }
        ]
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [{ slug: 'gpt-4o', displayName: 'GPT-4o' }]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('Flood Risk Team already has a key for GPT-4o')
    )
  })
})


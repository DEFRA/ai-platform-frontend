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

  test('Should name the configured research environment, not the Sandbox, when signed out', async () => {
    const { result } = await server.inject({ method: 'GET', url: '/' })

    expect(result).toEqual(
      expect.stringContaining('A key that works for 7 days, in the Infradev')
    )
    expect(result).toEqual(
      expect.stringContaining('Infradev is for building and trying things out.')
    )
    expect(result).not.toEqual(expect.stringContaining('Sandbox'))
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

  test('Should show team access as an OAuth client secret when signed in with an active team credential', async () => {
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

    expect(result).toContain(
      'Your team <strong>Flood Risk Team</strong> already has an OAuth client secret for its deployed models: GPT-4o.'
    )
    expect(result).toContain(
      'Anyone in the team can use it, so you may not need your own.'
    )
    expect(result).toContain(
      '<a class="govuk-link" href="/manage">View your team\'s client secret and model access</a>'
    )
    expect(result).toContain(
      'See every key and client secret you and your teams hold'
    )
    expect(result).not.toContain('already has a key')
    expect(result).not.toContain('once a model is deployed')
  })

  test('Should say when a team’s client secret covers no deployed model', async () => {
    const cookies = await signInViaOidc(server, fetchMock)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          {
            _id: 'cred-team-1',
            tier: 'team',
            teamId: 'team-1',
            status: 'active',
            allowedDeployments: []
          }
        ]
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ items: [{ _id: 'team-1', name: 'Flood Risk Team' }] })
    )
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toContain(
      'Your team <strong>Flood Risk Team</strong> already has an OAuth client secret, but no models are deployed for it at the moment.'
    )
    expect(result).toContain(
      'Anyone in the team can use it once a model is deployed'
    )
    expect(result).not.toContain('for its deployed models')
  })

  test('Should show one entry per team with an active client secret', async () => {
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
          },
          {
            _id: 'cred-team-2',
            tier: 'team',
            teamId: 'team-2',
            status: 'revoked',
            allowedDeployments: ['gpt-4o']
          },
          {
            _id: 'cred-team-3',
            tier: 'team',
            teamId: 'team-3',
            status: 'active',
            allowedDeployments: ['gpt-4-1-nano', 'gpt-4o']
          }
        ]
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          { _id: 'team-1', name: 'Flood Risk Team' },
          { _id: 'team-2', name: 'Old Team' },
          { _id: 'team-3', name: 'Coastal Erosion Team' }
        ]
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [
          { slug: 'gpt-4o', displayName: 'GPT-4o' },
          { slug: 'gpt-4-1-nano', displayName: 'GPT-4.1 nano' }
        ]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result.match(/data-testid="team-access"/g)).toHaveLength(2)
    expect(result).toContain('<strong>Flood Risk Team</strong>')
    expect(result).toContain(
      '<strong>Coastal Erosion Team</strong> already has an OAuth client secret for its deployed models: GPT-4.1 nano, GPT-4o.'
    )
    expect(result).not.toContain('Old Team')
  })

  test('Should escape the team and model names in the team access banner', async () => {
    const cookies = await signInViaOidc(server, fetchMock)
    const teamName = '<img src=x onerror=alert(1)>'

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
      JSON.stringify({ items: [{ _id: 'team-1', name: teamName }] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        items: [{ slug: 'gpt-4o', displayName: '<b>GPT-4o</b>' }]
      })
    )

    const { result } = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).not.toContain(teamName)
    expect(result).not.toContain('<b>GPT-4o</b>')
    expect(result).toContain(
      'Your team <strong>&lt;img src=x onerror=alert(1)&gt;</strong> already has an OAuth client secret for its deployed models: &lt;b&gt;GPT-4o&lt;/b&gt;.'
    )
  })
})

import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  mergeCookies,
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

const sampleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai'
}

const sampleCredential = {
  _id: 'cred-1',
  modelSlug: 'gpt-4o',
  status: 'active',
  keyHint: 'ab12',
  expiresAt: '2026-09-23T00:00:00.000Z',
  renewalCount: 0,
  renewalsRemaining: 3
}

async function signIn(server) {
  return signInViaOidc(server, fetchMock)
}

describe('#manageController', () => {
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

  test('GET /manage redirects to /sign-in when signed out', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/manage'
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/sign-in?returnTo=%2Fmanage')
  })

  test('GET /manage lists credentials with model names', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleCredential] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [sampleModel] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
    expect(result).toEqual(expect.stringContaining('ab12'))
  })

  test('GET /manage shows the empty state with no credentials', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('You do not have any credentials yet')
    )
  })

  test('GET /manage shows a "Your teams" placeholder', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('You are not a member of a team yet')
    )
  })

  test('POST /manage/credentials/{id}/renew shows a success banner', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({ ...sampleCredential, renewalCount: 1 })
    )

    const postRenew = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/renew',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postRenew.statusCode).toBe(303)
    expect(postRenew.headers.location).toBe('/manage')

    const redirectCookies = mergeCookies(cookies, postRenew)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(expect.stringContaining('Credential renewed'))
  })

  test('POST /manage/credentials/{id}/renew shows an error banner once the cap is reached', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Renewal cap reached for this credential',
        code: 'renewal-cap-reached'
      }),
      { status: 403 }
    )

    const postRenew = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/renew',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(postRenew.statusCode).toBe(303)

    const redirectCookies = mergeCookies(cookies, postRenew)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(
      expect.stringContaining('Renewal cap reached for this credential')
    )
  })

  test('GET /manage/credentials/{id}/revoke shows the confirm page', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('GPT-4o'))
  })

  test('POST /manage/credentials/{id}/revoke with "no" takes no action', async () => {
    const cookies = await signIn(server)
    fetchMock.mockClear()

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, confirmRevoke: 'no' }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/manage')
    expect(fetchMock.mock.calls).toHaveLength(0)
  })

  test('POST /manage/credentials/{id}/revoke with "yes" revokes and shows a banner', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(null, { status: 204 })

    const postRevoke = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb, confirmRevoke: 'yes' }
    })

    expect(postRevoke.statusCode).toBe(303)

    const redirectCookies = mergeCookies(cookies, postRevoke)
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))
    fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

    const { result } = await server.inject({
      method: 'GET',
      url: '/manage',
      headers: { cookie: cookieHeader(redirectCookies) }
    })

    expect(result).toEqual(expect.stringContaining('Credential revoked'))
  })

  test('POST /manage/credentials/{id}/revoke rejects an unselected radio', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(JSON.stringify(sampleCredential))
    fetchMock.mockResponseOnce(JSON.stringify(sampleModel))

    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/manage/credentials/cred-1/revoke',
      headers: { cookie: cookieHeader(cookies) },
      payload: { crumb: cookies.crumb }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toEqual(expect.stringContaining('There is a problem'))
  })

  test('GET /manage/credentials/{id}/revoke redirects to /manage for an unknown id', async () => {
    const cookies = await signIn(server)

    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 404,
        error: 'Not Found',
        message: 'Not Found'
      }),
      { status: 404 }
    )

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/manage/credentials/unknown-id/revoke',
      headers: { cookie: cookieHeader(cookies) }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/manage')
  })
})

import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import net from 'node:net'

import { createMockProvider, settingsFromEnv } from './mock-oidc-provider.js'

const API = '44444444-4444-4444-8444-444444444444'
const TENANT = '22222222-2222-4222-8222-222222222222'
const CLIENT = '33333333-3333-4333-8333-333333333333'
const OID = '11111111-1111-4111-8111-111111111111'
const REDIRECT = 'http://localhost:3000/auth/callback'
const USER_SCOPE = `openid profile email offline_access api://${API}/Portal.Access`

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function decodeJwt(token) {
  const [header, payload, signature] = token.split('.')

  return {
    header: JSON.parse(Buffer.from(header, 'base64url')),
    payload: JSON.parse(Buffer.from(payload, 'base64url')),
    signed: `${header}.${payload}`,
    signature: Buffer.from(signature, 'base64url')
  }
}

// How the frontend proves itself: the secret in the body (what openid-client
// does when it is given a client secret), so that is what the mock registers.
const clientSecretPost = { client_id: CLIENT, client_secret: 'mock-secret' }

describe('#mock OIDC provider', () => {
  let issuer
  let server

  beforeAll(async () => {
    const port = await freePort()
    const settings = settingsFromEnv({ MOCK_OIDC_PORT: String(port) })

    issuer = settings.issuer
    server = await new Promise((resolve) => {
      const listening = createMockProvider(settings).listen(port, () =>
        resolve(listening)
      )
    })
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  async function signingKeyVerifies(token) {
    const { keys } = await (await fetch(`${issuer}/jwks`)).json()
    const jwt = decodeJwt(token)
    const key = keys.find((candidate) => candidate.kid === jwt.header.kid)

    return verify(
      'RSA-SHA256',
      Buffer.from(jwt.signed),
      createPublicKey({ key, format: 'jwk' }),
      jwt.signature
    )
  }

  // The authorization code flow as a browser takes it: the mock approves the
  // one fixed person without a form, and the code comes back on the redirect.
  async function signIn() {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const jar = new Map()
    const cookies = () =>
      [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    let next = `${issuer}/auth?${new URLSearchParams({
      client_id: CLIENT,
      response_type: 'code',
      scope: USER_SCOPE,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'state-1',
      nonce: 'nonce-1'
    })}`

    for (let hop = 0; hop < 10; hop += 1) {
      const response = await fetch(next, {
        redirect: 'manual',
        headers: { cookie: cookies() }
      })

      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';')
        const [name, ...value] = pair.split('=')
        jar.set(name, value.join('='))
      }

      next = new URL(response.headers.get('location'), issuer).href

      if (next.startsWith(REDIRECT)) {
        break
      }
    }

    const code = new URL(next).searchParams.get('code')
    const tokens = await (
      await fetch(`${issuer}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...clientSecretPost,
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT,
          code_verifier: verifier
        })
      })
    ).json()

    return tokens
  }

  describe('a person signing in', () => {
    let tokens
    let access

    beforeAll(async () => {
      tokens = await signIn()
      access = decodeJwt(tokens.access_token)
    })

    test('gets an access token that is a v2 JWT for the API, signed with the keys at /jwks', async () => {
      expect(access.header.alg).toBe('RS256')
      expect(access.payload).toMatchObject({
        iss: issuer,
        aud: API,
        ver: '2.0',
        tid: TENANT
      })
      await expect(signingKeyVerifies(tokens.access_token)).resolves.toBe(true)
    })

    test('has the claims the backend checks for a delegated token: user type, Portal.Access, a member account', () => {
      expect(access.payload).toMatchObject({
        idtyp: 'user',
        scp: 'Portal.Access',
        acct: 0,
        azp: CLIENT,
        azpacr: '1',
        oid: OID,
        email: 'dev.user@defra.gov.uk',
        name: 'Dev User'
      })
      expect(access.payload.uti).toEqual(expect.any(String))
      expect(access.payload.nbf).toBeLessThanOrEqual(access.payload.iat)
    })

    test('lives for no more than the 2 hours the backend allows', () => {
      expect(access.payload.exp - access.payload.iat).toBeLessThanOrEqual(
        2 * 60 * 60
      )
    })

    test('also gets an ID token for the frontend (not the API) and a refresh token', () => {
      const id = decodeJwt(tokens.id_token)

      expect(id.payload.aud).toBe(CLIENT)
      expect(id.payload.nonce).toBe('nonce-1')
      expect(tokens.refresh_token).toEqual(expect.any(String))
    })

    test('a refresh gives a new access token with the same claims', async () => {
      const refreshed = await (
        await fetch(`${issuer}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            ...clientSecretPost,
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            scope: USER_SCOPE
          })
        })
      ).json()

      expect(decodeJwt(refreshed.access_token).payload).toMatchObject({
        idtyp: 'user',
        scp: 'Portal.Access',
        oid: OID,
        aud: API
      })
    })
  })

  describe('the frontend asking for its own token (client credentials)', () => {
    let tokens
    let access

    beforeAll(async () => {
      tokens = await (
        await fetch(`${issuer}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            ...clientSecretPost,
            grant_type: 'client_credentials',
            scope: `api://${API}/.default`
          })
        })
      ).json()
      access = decodeJwt(tokens.access_token)
    })

    test('is an app-only v2 JWT for the API with no scp and no acct', async () => {
      expect(access.payload).toMatchObject({
        iss: issuer,
        aud: API,
        ver: '2.0',
        tid: TENANT,
        idtyp: 'app',
        azp: CLIENT,
        azpacr: '1'
      })
      expect(access.payload).not.toHaveProperty('scp')
      expect(access.payload).not.toHaveProperty('acct')
      expect(access.payload).not.toHaveProperty('email')
      await expect(signingKeyVerifies(tokens.access_token)).resolves.toBe(true)
    })

    test('gets no refresh or ID token', () => {
      expect(tokens).not.toHaveProperty('refresh_token')
      expect(tokens).not.toHaveProperty('id_token')
    })
  })

  test('refuses a client it does not know', async () => {
    const response = await fetch(`${issuer}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...clientSecretPost,
        client_id: 'other',
        grant_type: 'client_credentials',
        scope: `api://${API}/.default`
      })
    })

    expect(response.status).toBe(401)
  })

  // oidc-provider 9.12 accepts a client secret in the body or in a Basic
  // header whichever way the client is registered, so a wrong registration
  // would not fail here: a stricter provider (or a later version) would answer
  // the frontend's secret in the body with invalid_client. Pin the registration.
  test('registers the client for the secret in the body, the method the frontend uses', async () => {
    const provider = createMockProvider(settingsFromEnv({}))
    const registered = await provider.Client.find(CLIENT)

    expect(registered.clientAuthMethod).toBe('client_secret_post')
  })

  describe('the tenant in the access token', () => {
    const CUSTOM_TENANT = '55555555-5555-4555-8555-555555555555'
    const OVERRIDE_TENANT = '66666666-6666-4666-8666-666666666666'

    async function appTokenTenant(env) {
      const port = await freePort()
      const settings = settingsFromEnv({ MOCK_OIDC_PORT: String(port), ...env })
      const listening = await new Promise((resolve) => {
        const running = createMockProvider(settings).listen(port, () =>
          resolve(running)
        )
      })

      try {
        const response = await fetch(`${settings.issuer}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            ...clientSecretPost,
            grant_type: 'client_credentials',
            scope: `api://${API}/.default`
          })
        })
        const { access_token: token } = await response.json()

        return decodeJwt(token).payload.tid
      } finally {
        await new Promise((resolve) => listening.close(resolve))
      }
    }

    test('is the AZURE_TENANT_ID a shared .env sets', async () => {
      expect(settingsFromEnv({ AZURE_TENANT_ID: CUSTOM_TENANT }).tenantId).toBe(
        CUSTOM_TENANT
      )
      await expect(
        appTokenTenant({ AZURE_TENANT_ID: CUSTOM_TENANT })
      ).resolves.toBe(CUSTOM_TENANT)
    })

    test('is MOCK_OIDC_TID when that is set too, as the explicit override', async () => {
      const env = {
        AZURE_TENANT_ID: CUSTOM_TENANT,
        MOCK_OIDC_TID: OVERRIDE_TENANT
      }

      expect(settingsFromEnv(env).tenantId).toBe(OVERRIDE_TENANT)
      await expect(appTokenTenant(env)).resolves.toBe(OVERRIDE_TENANT)
    })

    test('is the default when neither is set', () => {
      expect(settingsFromEnv({}).tenantId).toBe(TENANT)
    })
  })

  test('takes its settings from the environment, with GUID defaults the backend accepts', () => {
    expect(settingsFromEnv({})).toMatchObject({
      port: 3100,
      tenantId: TENANT,
      clientId: CLIENT,
      apiClientId: API,
      oid: OID,
      accessTokenTtlSeconds: 3600
    })
    expect(
      settingsFromEnv({
        AZURE_API_CLIENT_ID: 'x',
        MOCK_OIDC_PORT: '4000',
        MOCK_OIDC_ACCESS_TOKEN_TTL_SECONDS: '150'
      })
    ).toMatchObject({
      apiClientId: 'x',
      port: 4000,
      issuer: 'http://localhost:4000',
      accessTokenTtlSeconds: 150
    })
  })

  test('issues an access token that lives as long as it is set to', async () => {
    const port = await freePort()
    const settings = settingsFromEnv({
      MOCK_OIDC_PORT: String(port),
      MOCK_OIDC_ACCESS_TOKEN_TTL_SECONDS: '150'
    })
    const short = await new Promise((resolve) => {
      const listening = createMockProvider(settings).listen(port, () =>
        resolve(listening)
      )
    })

    const response = await fetch(`${settings.issuer}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...clientSecretPost,
        grant_type: 'client_credentials',
        scope: `api://${API}/.default`
      })
    })
    const { access_token: token, expires_in: expiresIn } = await response.json()
    await new Promise((resolve) => short.close(resolve))

    expect(expiresIn).toBe(150)
    const { payload } = decodeJwt(token)
    expect(payload.exp - payload.iat).toBe(150)
  })
})

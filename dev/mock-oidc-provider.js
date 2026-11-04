// Dev-only local OIDC provider standing in for Entra ID so the full sign-in
// journey can be exercised without a real Azure AD tenant. Never used in
// production — the frontend's oidc-client.js only points at this when
// OIDC_MOCK_ISSUER_URL is set and NODE_ENV isn't production.
//
// It issues what Entra issues for the portal (design E #portal): an ID token,
// and an access token for the API registration that is a v2 JWT with the
// claims the backend checks — `ver`, `tid`, `azp`, `azpacr`, `idtyp`, `scp`,
// `acct`, `oid`, `uti`, `email` and `name` for a person; `idtyp` `app` and
// neither `scp` nor `acct` for the frontend's own client-credentials token.
// The local backend trusts it through PORTAL_AUTH_MOCK_ISSUER_URL and its
// signing keys at /jwks, with the same validation as for Entra.
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Provider } from 'oidc-provider'

// Stable GUIDs, because the backend checks `tid`, `aud` and `azp` as GUIDs and
// keys people on `oid` and `tid`; the same person across restarts.
const DEFAULTS = {
  port: 3100,
  tenantId: '22222222-2222-4222-8222-222222222222',
  clientId: '33333333-3333-4333-8333-333333333333',
  clientSecret: 'mock-secret',
  apiClientId: '44444444-4444-4444-8444-444444444444',
  oid: '11111111-1111-4111-8111-111111111111',
  accessTokenTtlSeconds: 3600,
  email: 'dev.user@defra.gov.uk',
  name: 'Dev User',
  redirectUri: 'http://localhost:3000/auth/callback',
  postLogoutRedirectUri: 'http://localhost:3000/'
}

// Entra's azpacr: how the client authenticated (0 public, 1 secret, 2 certificate or federated).
const AZPACR_CLIENT_SECRET = '1'
const MS_PER_SECOND = 1000

/**
 * The mock provider's settings, from the environment the dev scripts share
 * with the frontend (AZURE_*, MOCK_OIDC_*) and the defaults above.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function settingsFromEnv(env = process.env) {
  const port = Number(env.MOCK_OIDC_PORT ?? DEFAULTS.port)

  return {
    port,
    issuer: env.OIDC_MOCK_ISSUER_URL ?? `http://localhost:${port}`,
    tenantId: env.MOCK_OIDC_TID ?? env.AZURE_TENANT_ID ?? DEFAULTS.tenantId,
    clientId: env.AZURE_CLIENT_ID ?? DEFAULTS.clientId,
    clientSecret: env.AZURE_CLIENT_SECRET ?? DEFAULTS.clientSecret,
    apiClientId: env.AZURE_API_CLIENT_ID ?? DEFAULTS.apiClientId,
    oid: env.MOCK_OIDC_OID ?? DEFAULTS.oid,
    // Short, to watch the frontend refresh a token before it ends.
    accessTokenTtlSeconds: Number(
      env.MOCK_OIDC_ACCESS_TOKEN_TTL_SECONDS ?? DEFAULTS.accessTokenTtlSeconds
    ),
    email: env.MOCK_OIDC_EMAIL ?? DEFAULTS.email,
    name: env.MOCK_OIDC_NAME ?? DEFAULTS.name,
    redirectUri: env.MOCK_OIDC_REDIRECT_URI ?? DEFAULTS.redirectUri,
    postLogoutRedirectUri:
      env.MOCK_OIDC_POST_LOGOUT_REDIRECT_URI ?? DEFAULTS.postLogoutRedirectUri
  }
}

/**
 * Builds the mock provider; the caller listens on it.
 * @param {ReturnType<typeof settingsFromEnv>} settings
 */
export function createMockProvider(settings) {
  const resource = `api://${settings.apiClientId}`
  const portalAccess = `${resource}/Portal.Access`
  const defaultScope = `${resource}/.default`

  const mockAccount = {
    accountId: 'mock-dev-user',
    email: settings.email,
    name: settings.name,
    oid: settings.oid,
    tid: settings.tenantId
  }

  const provider = new Provider(settings.issuer, {
    // Real Entra ID puts profile/email claims directly in the ID token; this
    // OSS provider defaults to userinfo-only for them, so match Entra's
    // behaviour here rather than changing how the frontend reads claims.
    conformIdTokenClaims: false,
    clients: [
      {
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uris: [settings.redirectUri],
        // Must be registered or the frontend's sign-out (RP-initiated logout) is rejected.
        post_logout_redirect_uris: [settings.postLogoutRedirectUri],
        response_types: ['code'],
        grant_types: [
          'authorization_code',
          'refresh_token',
          'client_credentials'
        ],
        // The frontend sends its secret in the body (openid-client's default
        // with a client secret), so the client is registered for that.
        token_endpoint_auth_method: 'client_secret_post'
      }
    ],
    claims: {
      openid: ['sub', 'oid', 'tid'],
      profile: ['name'],
      email: ['email']
    },
    findAccount(_ctx, sub) {
      if (sub !== mockAccount.accountId) {
        return undefined
      }

      return {
        accountId: sub,
        async claims() {
          return {
            sub,
            email: mockAccount.email,
            name: mockAccount.name,
            oid: mockAccount.oid,
            tid: mockAccount.tid
          }
        }
      }
    },
    cookies: {
      keys: ['mock-oidc-dev-only-cookie-secret'],
      // This mock only ever runs over plain http locally, so cookies must not
      // require Secure/SameSite=None (which real browsers/fetch would drop).
      short: { secure: false, sameSite: 'lax' },
      long: { secure: false, sameSite: 'lax' }
    },
    features: {
      devInteractions: { enabled: false },
      // Explicit: required to expose the end-session endpoint the frontend's sign-out redirects to.
      rpInitiatedLogout: { enabled: true },
      clientCredentials: { enabled: true },
      // The API registration: every token the frontend asks for is for it, as a
      // signed JWT the backend validates, whether or not the request names it.
      resourceIndicators: {
        enabled: true,
        defaultResource: () => resource,
        useGrantedResource: () => true,
        getResourceServerInfo: () => ({
          scope: `${portalAccess} ${defaultScope}`,
          audience: settings.apiClientId,
          accessTokenTTL: settings.accessTokenTtlSeconds,
          accessTokenFormat: 'jwt',
          jwt: { sign: { alg: 'RS256' } }
        })
      }
    },
    // Entra's v2 claims on the access token. A person's token has `scp`, `acct`
    // and the person's claims; the frontend's own has `idtyp` `app` and none of those.
    extraTokenClaims(_ctx, token) {
      if (token.kind !== 'AccessToken' && token.kind !== 'ClientCredentials') {
        return undefined
      }

      const delegated = token.kind === 'AccessToken' && token.accountId

      return {
        ver: '2.0',
        tid: settings.tenantId,
        azp: token.clientId,
        azpacr: AZPACR_CLIENT_SECRET,
        nbf: Math.floor(Date.now() / MS_PER_SECOND),
        uti: randomUUID(),
        ...(delegated
          ? {
              idtyp: 'user',
              scp: 'Portal.Access',
              acct: 0,
              oid: mockAccount.oid,
              email: mockAccount.email,
              name: mockAccount.name
            }
          : { idtyp: 'app', oid: token.clientId })
      }
    }
  })

  // Entra gives a refresh token for `offline_access` on any sign-in; this
  // provider (as the OpenID Connect spec says) only honours that scope when
  // the request asks for consent, so ask on the frontend's behalf. The
  // interaction below approves it at once.
  provider.use(async (ctx, next) => {
    if (ctx.method === 'GET' && ctx.path === '/auth') {
      const query = new URLSearchParams(ctx.querystring)
      const prompts = (query.get('prompt') ?? '').split(' ').filter(Boolean)

      if (
        (query.get('scope') ?? '').split(' ').includes('offline_access') &&
        !prompts.includes('consent')
      ) {
        query.set('prompt', [...prompts, 'consent'].join(' '))
        ctx.querystring = query.toString()
      }
    }

    return next()
  })

  // No login/consent form: every interaction is auto-approved as the one fixed
  // mock account, since this only exists to unblock local/dev sign-in testing.
  provider.use(async (ctx, next) => {
    const match = ctx.path.match(/^\/interaction\/([^/]+)$/)

    if (!match || ctx.method !== 'GET') {
      return next()
    }

    try {
      const details = await provider.interactionDetails(ctx.req, ctx.res)
      const { prompt, session, params } = details
      ctx.respond = false

      if (prompt.name === 'login') {
        await provider.interactionFinished(
          ctx.req,
          ctx.res,
          { login: { accountId: mockAccount.accountId } },
          { mergeWithLastSubmission: false }
        )
        return undefined
      }

      if (prompt.name === 'consent') {
        const grant = details.grantId
          ? await provider.Grant.find(details.grantId)
          : new provider.Grant({
              accountId: session.accountId,
              clientId: params.client_id
            })

        // The API's scope is granted for the API; the rest are OpenID scopes.
        const requested = (params.scope ?? 'openid').split(' ')
        grant.addOIDCScope(
          requested.filter((name) => !name.startsWith('api://')).join(' ')
        )
        const resourceScopes = requested.filter((name) =>
          name.startsWith('api://')
        )
        if (resourceScopes.length > 0) {
          grant.addResourceScope(resource, resourceScopes.join(' '))
        }
        const grantId = await grant.save()

        await provider.interactionFinished(
          ctx.req,
          ctx.res,
          { consent: { grantId } },
          { mergeWithLastSubmission: true }
        )
        return undefined
      }

      ctx.respond = true
      ctx.status = 501
      ctx.body = `Unsupported interaction prompt: ${prompt.name}`
      return undefined
    } catch (error) {
      console.error('Mock OIDC provider interaction failed', error)
      throw error
    }
  })

  return provider
}

// Run directly (`npm run dev:mock-oidc`), not when a test imports it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const settings = settingsFromEnv()

  createMockProvider(settings).listen(settings.port, () => {
    console.log(`Mock OIDC provider listening on ${settings.issuer}`)
    console.log(`Frontend client id (AZURE_CLIENT_ID): ${settings.clientId}`)
    console.log(`API client id (AZURE_API_CLIENT_ID): ${settings.apiClientId}`)
    console.log(`Tenant id (AZURE_TENANT_ID): ${settings.tenantId}`)
    console.log(`Redirect URI: ${settings.redirectUri}`)
  })
}

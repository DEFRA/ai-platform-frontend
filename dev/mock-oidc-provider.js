// Dev-only local OIDC provider standing in for Entra ID so the full sign-in
// journey can be exercised without a real Azure AD tenant. Never used in
// production — the frontend's oidc-client.js only points at this when
// OIDC_MOCK_ISSUER_URL is set and NODE_ENV isn't production.
import { Provider } from 'oidc-provider'

const port = process.env.MOCK_OIDC_PORT ?? 3100
const issuer = process.env.OIDC_MOCK_ISSUER_URL ?? `http://localhost:${port}`
const clientId = process.env.AZURE_CLIENT_ID ?? 'mock-client'
const clientSecret = process.env.AZURE_CLIENT_SECRET ?? 'mock-secret'
const redirectUri =
  process.env.MOCK_OIDC_REDIRECT_URI ?? 'http://localhost:3000/auth/callback'
const postLogoutRedirectUri =
  process.env.MOCK_OIDC_POST_LOGOUT_REDIRECT_URI ?? 'http://localhost:3000/'

const mockAccount = {
  accountId: 'mock-dev-user',
  email: process.env.MOCK_OIDC_EMAIL ?? 'dev.user@defra.gov.uk',
  name: process.env.MOCK_OIDC_NAME ?? 'Dev User'
}

const provider = new Provider(issuer, {
  // Real Entra ID puts profile/email claims directly in the ID token; this
  // OSS provider defaults to userinfo-only for them, so match Entra's
  // behaviour here rather than changing how the frontend reads claims.
  conformIdTokenClaims: false,
  clients: [
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      // Must be registered or the frontend's sign-out (RP-initiated logout) is rejected.
      post_logout_redirect_uris: [postLogoutRedirectUri],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'client_secret_basic'
    }
  ],
  claims: {
    openid: ['sub'],
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
        return { sub, email: mockAccount.email, name: mockAccount.name }
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
    rpInitiatedLogout: { enabled: true }
  }
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

      grant.addOIDCScope(params.scope ?? 'openid')
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

provider.listen(port, () => {
  console.log(`Mock OIDC provider listening on ${issuer}`)
  console.log(`Client id: ${clientId}`)
  console.log(`Redirect URI: ${redirectUri}`)
})

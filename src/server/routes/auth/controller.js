import * as client from 'openid-client'
import Joi from 'joi'

import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { getOidcConfig } from '#/server/common/helpers/oidc-client.js'
import { isEligibleAccount } from '#/server/common/helpers/sign-in-eligibility.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { tokensFromResponse } from '#/server/common/helpers/access-token.js'
import { userScope } from '#/server/common/helpers/portal-scopes.js'
import { safeReturnTo } from '#/server/common/helpers/safe-redirect.js'
import {
  setOidcLoginState,
  takeOidcLoginState,
  setSessionTokens,
  setSessionUser,
  resetSession
} from '#/server/common/helpers/session.js'
import { startSessionClock } from '#/server/common/helpers/session-lifetime.js'

export const loginQuerySchema = Joi.object({
  returnTo: Joi.string().optional(),
  prompt: Joi.string().valid('select_account').optional()
}).unknown(false)

function redirectUri() {
  return `${config.get('appBaseUrl')}/auth/callback`
}

function currentUrl(request) {
  return new URL(
    request.url.pathname + request.url.search,
    config.get('appBaseUrl')
  )
}

// Renders a real page instead of redirecting to /sign-in, which would just
// bounce straight back to /auth/login and loop forever while Entra ID can't be reached.
function unavailableView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Sign-in unavailable',
      heading: 'Sign-in is currently unavailable',
      message:
        'We could not reach the sign-in service. Please try again shortly.',
      actionHref: '/auth/login',
      actionText: 'Try again'
    })
    .code(statusCodes.serviceUnavailable)
}

function failedView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Sign-in problem',
      heading: 'We could not sign you in',
      message: 'Your sign-in attempt did not complete.',
      actionHref: '/auth/login',
      actionText: 'Try signing in again'
    })
    .code(statusCodes.badRequest)
}

// Shown when sign-in succeeds at Entra ID but the account is not eligible: not
// on an allowed email domain (e.g. the wrong tenant) or a guest, which the
// frontend tells from the ID token claims before anything is kept, or an
// account the backend refuses the access token for (401). The session has
// ended, so there is no loop back through sign-in.
function notEligibleView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Sign-in not allowed',
      heading: 'You cannot sign in with this account',
      message: 'Your account is not eligible to use this service.',
      actionHref: '/sign-in?prompt=select_account',
      actionText: 'Try a different account'
    })
    .code(statusCodes.forbidden)
}

export const authController = {
  login: {
    options: {
      validate: { query: loginQuerySchema }
    },
    async handler(request, h) {
      let oidcConfig

      try {
        oidcConfig = await getOidcConfig()
      } catch (error) {
        request.logger.error({ err: error }, 'Entra ID sign-in is unavailable')
        return unavailableView(h)
      }

      const codeVerifier = client.randomPKCECodeVerifier()
      const codeChallenge =
        await client.calculatePKCECodeChallenge(codeVerifier)
      const state = client.randomState()
      const nonce = client.randomNonce()

      setOidcLoginState(request, {
        codeVerifier,
        state,
        nonce,
        returnTo: request.query.returnTo ?? ''
      })

      const authorizationUrl = client.buildAuthorizationUrl(oidcConfig, {
        redirect_uri: redirectUri(),
        scope: userScope(),
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
        ...(request.query.prompt ? { prompt: request.query.prompt } : {})
      })

      return h.redirect(authorizationUrl.href)
    }
  },
  callback: {
    async handler(request, h) {
      const pending = takeOidcLoginState(request)

      if (!pending) {
        return h.redirect('/sign-in').code(statusCodes.seeOther)
      }

      let oidcConfig
      try {
        // The code grant authenticates the client (design E #portal).
        oidcConfig = await getOidcConfig({ authenticateClient: true })
      } catch (error) {
        request.logger.error({ err: error }, 'Entra ID sign-in is unavailable')
        return unavailableView(h)
      }

      let tokens
      try {
        tokens = await client.authorizationCodeGrant(
          oidcConfig,
          currentUrl(request),
          {
            pkceCodeVerifier: pending.codeVerifier,
            expectedState: pending.state,
            expectedNonce: pending.nonce
          }
        )
      } catch (error) {
        request.logger.warn({ err: error }, 'Entra ID sign-in callback failed')
        return failedView(h)
      }

      // The frontend decides eligibility from the ID token claims, the only
      // place a guest can be told from a member; the backend then checks the
      // access token it is given. Nothing of a refused sign-in is kept.
      if (!isEligibleAccount(tokens.claims())) {
        // Not logged with the address: it says who, and the page says enough.
        request.logger.warn('Sign-in refused: the account is not eligible')
        return notEligibleView(h)
      }

      // A new session ID at sign-in, so one planted or seen before sign-in
      // (session fixation) is worth nothing; the old session and what was in
      // it are dropped. This comes first: a reset after the tokens are set
      // would drop them. The idle and overall limits start from now.
      resetSession(request)
      startSessionClock(request)

      // The tokens go into the server-side session: the access token is what
      // the backend takes as who this is, the refresh token keeps it fresh.
      // The backend reads the person (oid, tid, email, name) from the access
      // token's claims, so nothing about them is sent here (design E #portal).
      setSessionTokens(request, tokensFromResponse(tokens))

      let user
      try {
        ;({ user } = await apiClient(request).put('/v1/users/me'))
      } catch (error) {
        // However it failed, nothing of this sign-in is kept.
        resetSession(request)

        if (
          error instanceof ApiError &&
          error.statusCode === statusCodes.unauthorized
        ) {
          return notEligibleView(h)
        }

        throw error
      }

      setSessionUser(request, {
        id: user._id,
        email: user.email,
        displayName: user.displayName
      })

      const returnTo = safeReturnTo(pending.returnTo, '/')

      return h.redirect(returnTo).code(statusCodes.seeOther)
    }
  }
}

import * as client from 'openid-client'
import Joi from 'joi'

import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { getOidcConfig } from '#/server/common/helpers/oidc-client.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  setOidcLoginState,
  takeOidcLoginState,
  setSessionUser
} from '#/server/common/helpers/session.js'

const scope = 'openid profile email'

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
        'We could not reach Entra ID to sign you in. Please try again shortly.',
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

// Shown when Entra ID login succeeds but the account's email domain isn't
// on the allow-list (e.g. the wrong tenant).
function domainNotAllowedView(h) {
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
        scope,
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
        oidcConfig = await getOidcConfig()
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

      const claims = tokens.claims()
      const email = claims.email ?? claims.preferred_username
      const displayName = claims.name ?? claims.email

      let user
      try {
        ;({ user } = await apiClient(request).post('/v1/users', {
          email,
          displayName
        }))
      } catch (error) {
        if (error instanceof ApiError && error.code === 'domain-not-allowed') {
          return domainNotAllowedView(h)
        }

        throw error
      }

      setSessionUser(request, {
        id: user._id,
        email: user.email,
        displayName: user.displayName
      })

      const returnTo = pending.returnTo || '/connect'

      return h.redirect(returnTo).code(statusCodes.seeOther)
    }
  }
}

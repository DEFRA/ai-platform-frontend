import * as client from 'openid-client'

import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { getOidcConfig } from '#/server/common/helpers/oidc-client.js'
import {
  setOidcLoginState,
  takeOidcLoginState,
  setPendingOidcIdentity
} from '#/server/common/helpers/session.js'

const scope = 'openid profile email'

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

export const authController = {
  login: {
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
        nonce
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

      setPendingOidcIdentity(request, {
        email: claims.email ?? claims.preferred_username,
        displayName: claims.name ?? claims.email
      })

      const returnTo = pending.returnTo
        ? `?returnTo=${encodeURIComponent(pending.returnTo)}`
        : ''

      return h.redirect(`/sign-in/team${returnTo}`).code(statusCodes.seeOther)
    }
  }
}

import yar from '@hapi/yar'

import { config } from '#/config/config.js'

const sessionConfig = config.get('session')

export const sessionCache = {
  plugin: yar,
  options: {
    name: sessionConfig.cache.name,
    cache: {
      cache: sessionConfig.cache.name,
      expiresIn: sessionConfig.cache.ttl
    },
    // Always server-side: the cookie carries only the session id, so who is
    // signed in, a half-made request and a client secret awaiting display
    // never sit in the browser, and signing out ends the session for good
    // (a cookie kept from before finds nothing).
    maxCookieSize: 0,
    storeBlank: false,
    errorOnCacheNotReady: true,
    cookieOptions: {
      password: sessionConfig.cookie.password,
      ttl: sessionConfig.cookie.ttl,
      isSecure: config.get('session.cookie.secure'),
      // Must be 'Lax' (not the stricter 'Strict'): the OIDC provider redirects the
      // browser straight back to /auth/callback, a cross-site top-level navigation
      // that 'Strict' cookies aren't sent on, which would drop the session mid-flow.
      isSameSite: 'Lax',
      clearInvalid: true
    }
  }
}

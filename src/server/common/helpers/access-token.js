import * as client from 'openid-client'

import { ApiError } from '#/server/common/helpers/api-error.js'
import { getOidcConfig } from '#/server/common/helpers/oidc-client.js'
import { appScope, userScope } from '#/server/common/helpers/portal-scopes.js'
import {
  getSessionTokens,
  setSessionTokens
} from '#/server/common/helpers/session.js'

// A token is renewed this long before it ends, so a call never starts with
// one that expires on the way.
const RENEW_EARLY_MS = 2 * 60 * 1000
const MS_PER_SECOND = 1000

let appToken
let appTokenRequest
const userTokenRequests = new Map()

/**
 * What the session keeps of a token response. A refresh may not send a new
 * refresh token; the one already held stays.
 * @param {{ access_token: string, refresh_token?: string, expires_in: number }} response
 * @param {{ refreshToken?: string }} [previous]
 */
export function tokensFromResponse(response, previous) {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + response.expires_in * MS_PER_SECOND
  }
}

const isFresh = (tokens) => tokens.expiresAt - RENEW_EARLY_MS > Date.now()

async function refresh(tokens) {
  if (!tokens.refreshToken) {
    throw new Error('The session holds no refresh token')
  }

  const oidcConfig = await getOidcConfig({ authenticateClient: true })
  const response = await client.refreshTokenGrant(
    oidcConfig,
    tokens.refreshToken,
    { scope: userScope() }
  )

  return tokensFromResponse(response, tokens)
}

// One refresh for a person's tokens at a time: a page makes several calls at
// once, and each would otherwise spend the same refresh token.
function refreshOnce(tokens) {
  const key = tokens.refreshToken

  if (!userTokenRequests.has(key)) {
    userTokenRequests.set(
      key,
      refresh(tokens).finally(() => userTokenRequests.delete(key))
    )
  }

  return userTokenRequests.get(key)
}

/**
 * The signed-in person's access token for the backend, refreshed first when it
 * is within 2 minutes of ending. A failed refresh is a 401 `ApiError`: the
 * error handler ends the session and sends the person to sign in.
 * @param {object} request the Hapi request, whose session holds the tokens
 * @returns {Promise<string>}
 */
export async function getUserToken(request) {
  const tokens = getSessionTokens(request)

  if (!tokens) {
    throw new ApiError({
      statusCode: 401,
      code: 'not-signed-in',
      message: 'There is no signed-in session'
    })
  }

  if (isFresh(tokens)) {
    return tokens.accessToken
  }

  try {
    const renewed = await refreshOnce(tokens)

    setSessionTokens(request, renewed)

    return renewed.accessToken
  } catch (error) {
    request.logger?.warn({ err: error }, 'Refreshing the access token failed')

    throw new ApiError({
      statusCode: 401,
      code: 'token-refresh-failed',
      message: 'The access token could not be refreshed'
    })
  }
}

async function requestAppToken() {
  const oidcConfig = await getOidcConfig({ authenticateClient: true })
  const response = await client.clientCredentialsGrant(oidcConfig, {
    scope: appScope()
  })

  appToken = tokensFromResponse(response)

  return appToken
}

/**
 * The frontend's own app-only token for the backend, used before anyone has
 * signed in (the catalogue's reads). Kept in memory until 2 minutes before it
 * ends; one request at a time. A failure is a 502 `ApiError`, never cached.
 * @returns {Promise<string>}
 */
export async function getAppToken() {
  if (appToken && isFresh(appToken)) {
    return appToken.accessToken
  }

  appTokenRequest ??= requestAppToken().finally(() => {
    appTokenRequest = undefined
  })

  try {
    return (await appTokenRequest).accessToken
  } catch (error) {
    throw new ApiError({
      statusCode: 502,
      code: 'upstream-unavailable',
      message: `No access token for the API: ${error.message}`
    })
  }
}

/**
 * Test-only: forgets the cached app token and any request in flight.
 */
export function resetAppToken() {
  appToken = undefined
  appTokenRequest = undefined
  userTokenRequests.clear()
}

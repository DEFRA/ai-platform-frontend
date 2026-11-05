import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, markUnauthorised } from './api-error.js'
import { getAppToken, getUserToken } from './access-token.js'
import { getSessionTokens, getSessionUser } from './session.js'

export { ApiError }

const apiBaseUrl = config.get('apiBaseUrl')
const tracingHeader = config.get('tracing.header')
const defaultTimeoutMs = 5000

// The person's access token once they have signed in, the frontend's own
// app-only token before (the catalogue's reads). Who is calling is the token,
// never a header: the backend takes nothing else on trust. A signed-in person
// never falls back to the app identity: with no tokens (a session from before
// tokens were kept) `getUserToken` refuses, and the session ends.
function accessTokenFor(hapiRequest) {
  return getSessionTokens(hapiRequest) || getSessionUser(hapiRequest)
    ? getUserToken(hapiRequest)
    : getAppToken()
}

// Where a token cannot be had for the person, or the backend refuses it, the
// request is marked so the session ends even if the page swallows the error.
async function bearerFor(hapiRequest) {
  try {
    return `Bearer ${await accessTokenFor(hapiRequest)}`
  } catch (error) {
    if (error.statusCode === statusCodes.unauthorized) {
      markUnauthorised(hapiRequest)
    }

    throw error
  }
}

async function callApi(
  hapiRequest,
  path,
  { method = 'GET', payload, idempotencyKey } = {}
) {
  const headers = {
    'content-type': 'application/json',
    authorization: await bearerFor(hapiRequest)
  }

  const traceId = hapiRequest?.headers?.[tracingHeader]
  if (traceId) {
    headers[tracingHeader] = traceId
  }

  if (idempotencyKey) {
    headers['idempotency-key'] = idempotencyKey
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), defaultTimeoutMs)

  let response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal
    })
  } catch (error) {
    throw new ApiError({
      statusCode: 502,
      code: 'upstream-unavailable',
      message: error.message
    })
  } finally {
    clearTimeout(timeout)
  }

  const body =
    response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status === statusCodes.unauthorized) {
      markUnauthorised(hapiRequest)
    }

    throw new ApiError({
      ...body,
      statusCode: response.status,
      code: body?.code ?? 'error',
      message: body?.message ?? 'Something went wrong'
    })
  }

  return body
}

/**
 * Thin fetch wrapper for calling ai-platform-backend-api, the only way the
 * frontend does. Sends the bearer token (the signed-in person's, or the
 * frontend's own before sign-in) and forwards the CDP tracing header; maps
 * non-2xx responses to ApiError.
 */
export function apiClient(hapiRequest) {
  return {
    get: (path, options) =>
      callApi(hapiRequest, path, { ...options, method: 'GET' }),
    post: (path, payload, options) =>
      callApi(hapiRequest, path, { ...options, method: 'POST', payload }),
    patch: (path, payload, options) =>
      callApi(hapiRequest, path, { ...options, method: 'PATCH', payload }),
    put: (path, options) =>
      callApi(hapiRequest, path, { ...options, method: 'PUT' }),
    del: (path, options) =>
      callApi(hapiRequest, path, { ...options, method: 'DELETE' })
  }
}

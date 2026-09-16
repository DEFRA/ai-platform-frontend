import { config } from '#/config/config.js'

const apiBaseUrl = config.get('apiBaseUrl')
const tracingHeader = config.get('tracing.header')
const defaultTimeoutMs = 5000

/**
 * Error thrown for any non-2xx response from the backend API, carrying its stable `code`.
 */
export class ApiError extends Error {
  constructor({ statusCode, code, message }) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

async function callApi(
  hapiRequest,
  path,
  { method = 'GET', payload, userId, idempotencyKey } = {}
) {
  const headers = { 'content-type': 'application/json' }

  const traceId = hapiRequest?.headers?.[tracingHeader]
  if (traceId) {
    headers[tracingHeader] = traceId
  }

  if (userId) {
    headers['x-user-id'] = userId
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
    throw new ApiError({
      statusCode: response.status,
      code: body?.code ?? 'error',
      message: body?.message ?? 'Something went wrong'
    })
  }

  return body
}

/**
 * Thin fetch wrapper for calling ai-platform-backend-api. Forwards the CDP
 * tracing header and the signed-in user's id; maps non-2xx responses to ApiError.
 */
export function apiClient(hapiRequest) {
  return {
    get: (path, options) =>
      callApi(hapiRequest, path, { ...options, method: 'GET' }),
    post: (path, payload, options) =>
      callApi(hapiRequest, path, { ...options, method: 'POST', payload })
  }
}

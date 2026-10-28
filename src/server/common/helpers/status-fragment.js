// The status of a page that follows a change, on its own. A page whose status
// moves (a team's Models tab, the page that follows a request) can be asked
// for just that part with `?fragment=status`; `progress-refresh.js` does so
// every few seconds while the part says it is `data-in-progress`.
import { createHash } from 'node:crypto'

import { statusCodes } from '#/server/common/constants/status-codes.js'

const FRAGMENT_QUERY = 'fragment'
const STATUS_FRAGMENT = 'status'
// Each answer is checked afresh with its ETag, never kept by a cache.
const NO_STORE = 'no-store'

/**
 * Whether the request is for the status on its own.
 * @param {{query: Record<string, unknown>}} request
 * @returns {boolean}
 */
export function wantsStatusFragment(request) {
  return request.query[FRAGMENT_QUERY] === STATUS_FRAGMENT
}

/**
 * Where a page's status can be fetched from, for the page to hand to the script.
 * @param {string} path - The page's own path.
 * @returns {string}
 */
export function statusFragmentUrl(path) {
  return `${path}?${FRAGMENT_QUERY}=${STATUS_FRAGMENT}`
}

/**
 * The status partial on its own, as HTML. Its ETag follows its content, so
 * Hapi answers 304 when the person already has this version.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {string} template - The partial, relative to `server/routes`.
 * @param {object} context
 * @returns {Promise<import('@hapi/hapi').ResponseObject>}
 */
export async function statusFragmentResponse(request, h, template, context) {
  const html = await request.render(template, context)
  const etag = createHash('sha256').update(html).digest('base64url')

  return h
    .response(html)
    .type('text/html')
    .etag(etag)
    .header('cache-control', NO_STORE)
}

/**
 * The answer when the status cannot be read just now: the page keeps what it
 * has and asks again.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function statusFragmentUnavailable(h) {
  return h
    .response()
    .code(statusCodes.serviceUnavailable)
    .header('cache-control', NO_STORE)
}

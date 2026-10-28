// Progressive enhancement for a page that follows a change (the page after a
// request, a team's Models tab). The server renders the status part
// (`data-in-progress`) inside a polite live region marked
// `data-progress-refresh="<fragment address>"`. While the status says it is in
// progress, this asks for the fragment every few seconds and swaps it in, so
// the page updates without moving focus (focus stays on the same control; if
// that control goes, it moves to the region, never to the top of the page).
// Without script, the "Check progress"
// link in the status does the same by loading the page again. It stops when
// nothing is in progress, when the page is hidden (and starts again when it is
// shown), and for good when the answer is not a status (signed out, not found).

const POLL_INTERVAL_MS = 5000
const MAX_DELAY_MS = 60000
const REQUEST_TIMEOUT_MS = 10000
const REGION_SELECTOR = '[data-progress-refresh]'
const STATUS_SELECTOR = '[data-in-progress]'
const NOT_MODIFIED = 304
const FIRST_CLIENT_ERROR = 400
const FIRST_SERVER_ERROR = 500

// How a request went: the status is shown as it is, or to ask again, or to
// stop asking.
const CURRENT = 'current'
const RETRY = 'retry'
const STOP = 'stop'

function isInProgress(status) {
  return status?.dataset.inProgress === 'true'
}

// What has focus inside the region, in terms that survive the content being
// replaced: an id, or a link's address (an element with neither cannot be found
// again). Null when focus is not inside the region, or is on the region itself,
// which the swap does not remove.
function focusedIn(region) {
  const active = document.activeElement

  if (active === region || !region.contains(active)) {
    return null
  }

  return {
    tag: active.localName,
    id: active.id,
    href: active.getAttribute('href')
  }
}

function findAgain(region, saved) {
  if (!saved.id && !saved.href) {
    return undefined
  }

  return [...region.querySelectorAll(saved.tag)].find((element) =>
    saved.id
      ? element.id === saved.id
      : element.getAttribute('href') === saved.href
  )
}

// Focus stays on the same control. When that control has gone (a link that
// is only there while something is in progress), it moves to the region, so
// the person keeps their place instead of dropping to the top of the page.
function restoreFocus(region, saved) {
  const match = findAgain(region, saved)

  if (match) {
    match.focus({ preventScroll: true })
    return
  }

  region.setAttribute('tabindex', '-1')
  region.focus({ preventScroll: true })
}

function swapIn(region, content) {
  const saved = focusedIn(region)

  region.replaceChildren(...content.childNodes)

  if (saved) {
    restoreFocus(region, saved)
  }
}

// The fragment, or null when the answer is not one (so not ours to show).
function parseStatus(html) {
  const { body } = new window.DOMParser().parseFromString(html, 'text/html')

  return body.querySelector(STATUS_SELECTOR) ? body : null
}

// Asks for the fragment once. What comes back is the outcome, and for a new
// version its content and ETag. A 304 means the person has this version.
async function requestStatus(url, etag) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const headers = { Accept: 'text/html' }

    if (etag) {
      headers['If-None-Match'] = etag
    }

    const response = await fetch(url, {
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      // A signed-out answer is a redirect to the sign-in provider: do not
      // follow it (the provider's address is not ours to fetch).
      redirect: 'manual',
      signal: controller.signal
    })

    if (response.status === NOT_MODIFIED) {
      return { outcome: CURRENT }
    }

    if (
      response.type === 'opaqueredirect' ||
      (response.status >= FIRST_CLIENT_ERROR &&
        response.status < FIRST_SERVER_ERROR)
    ) {
      return { outcome: STOP }
    }

    if (!response.ok) {
      return { outcome: RETRY }
    }

    const content = parseStatus(await response.text())

    return content
      ? { outcome: CURRENT, content, etag: response.headers.get('ETag') }
      : { outcome: STOP }
  } finally {
    clearTimeout(timeout)
  }
}

function watch(region) {
  const url = region.dataset.progressRefresh
  let etag = null
  let failures = 0
  let timer = null
  let waiting = false
  let stopped = false

  function delay() {
    return Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_DELAY_MS)
  }

  function clearTimer() {
    clearTimeout(timer)
    timer = null
  }

  // Asks once and shows what came back: how it went, for what to do next.
  async function refresh() {
    const result = await requestStatus(url, etag)

    if (!result.content) {
      return result.outcome
    }

    etag = result.etag
    swapIn(region, result.content)

    return isInProgress(region.querySelector(STATUS_SELECTOR)) ? CURRENT : STOP
  }

  function schedule() {
    clearTimer()

    // A hidden page asks nothing; showing it again asks at once.
    if (!stopped && !document.hidden) {
      timer = setTimeout(check, delay())
    }
  }

  async function check() {
    timer = null
    waiting = true

    let outcome

    try {
      outcome = await refresh()
    } catch {
      outcome = RETRY
    }

    waiting = false

    if (outcome === STOP) {
      stop()
      return
    }

    failures = outcome === RETRY ? failures + 1 : 0
    schedule()
  }

  function onVisibilityChange() {
    if (document.hidden) {
      clearTimer()
      return
    }

    if (!stopped && !waiting) {
      clearTimer()
      check().catch(stop)
    }
  }

  function stop() {
    stopped = true
    clearTimer()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  schedule()

  return stop
}

/**
 * Starts following the page's status when it is in progress.
 * @param {ParentNode} [root]
 * @returns {(() => void) | null} Stops following, or null when there is nothing to follow.
 */
export function initProgressRefresh(root = document) {
  const region = root.querySelector(REGION_SELECTOR)

  if (!region || !isInProgress(region.querySelector(STATUS_SELECTOR))) {
    return null
  }

  return watch(region)
}

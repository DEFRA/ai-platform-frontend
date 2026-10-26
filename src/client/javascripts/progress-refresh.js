// Progressive enhancement for a page that follows a change (the page after a
// request, a team's Models tab). The server renders the status part
// (`data-in-progress`) inside a polite live region marked
// `data-progress-refresh="<fragment address>"`. While the status says it is in
// progress, this asks for the fragment every few seconds and swaps it in, so
// the page updates without moving focus. Without script, the "Check progress"
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
  return status?.getAttribute('data-in-progress') === 'true'
}

// What has focus inside the region, in terms that survive the content being
// replaced: an id, or a link's address. Anything else cannot be found again.
function focusedIn(region) {
  const active = document.activeElement
  const id = active?.id
  const href = active?.getAttribute?.('href')

  if (!active || !region.contains(active) || !(id || href)) {
    return null
  }

  return { tag: active.localName, id, href }
}

function restoreFocus(region, saved) {
  const match = [...region.querySelectorAll(saved.tag)].find((element) =>
    saved.id
      ? element.id === saved.id
      : element.getAttribute('href') === saved.href
  )

  match?.focus({ preventScroll: true })
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

function watch(region) {
  const url = region.getAttribute('data-progress-refresh')
  let etag = null
  let failures = 0
  let timer = null
  let waiting = false
  let stopped = false

  function delay() {
    return Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_DELAY_MS)
  }

  // Asks for the fragment once. A 304 means the person has this version.
  async function load() {
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
        signal: controller.signal
      })

      if (response.status === NOT_MODIFIED) {
        return CURRENT
      }

      if (
        response.redirected ||
        (response.status >= FIRST_CLIENT_ERROR &&
          response.status < FIRST_SERVER_ERROR)
      ) {
        return STOP
      }

      if (!response.ok) {
        return RETRY
      }

      const content = parseStatus(await response.text())

      if (!content) {
        return STOP
      }

      etag = response.headers.get('ETag')
      swapIn(region, content)

      return isInProgress(region.querySelector(STATUS_SELECTOR))
        ? CURRENT
        : STOP
    } finally {
      clearTimeout(timeout)
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = null

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
      outcome = await load()
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
      clearTimeout(timer)
      timer = null
    } else if (!stopped && !waiting) {
      clearTimeout(timer)
      check()
    }
  }

  function stop() {
    stopped = true
    clearTimeout(timer)
    timer = null
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

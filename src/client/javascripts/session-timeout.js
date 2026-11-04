// Progressive enhancement for the session limits (design E #portal): a session
// ends after 30 minutes without a request or 8 hours after sign-in, and a person
// is warned shortly before (WCAG 2.2 SC 2.2.1 Timing Adjustable). The server
// renders a closed <dialog data-module="app-session-timeout"> on every
// signed-in page, with how long is left on each limit. Without script it stays
// closed and the server ends the session on the next request, sending the
// person to the signed-out page.
//
// With script: shortly before the earlier limit the dialog opens as a modal
// (the browser holds focus inside it and returns focus to where it was on
// close), counting down and saying so to a screen reader every 30 seconds.
// "Stay signed in" asks the server for more idle time; the 8 hour limit cannot
// be moved, so when that is the limit that is near the dialog says so and
// offers only sign-out. Before warning, and again when the time is up, the
// script asks the server how long is really left (another tab may have kept
// the session alive); asking never restarts the idle time.

const SELECTOR = '[data-module="app-session-timeout"]'
const MS = 1000
const SECONDS_PER_MINUTE = 60
const ANNOUNCE_EVERY_SECONDS = 30
const FIRST_CLIENT_ERROR = 400
const FIRST_SERVER_ERROR = 500

// How a request went: the session has ended, the server gave the times, or
// it could not be known (offline, a server error), so the clock here decides.
const ENDED = 'ended'
const CURRENT = 'current'
const UNKNOWN = 'unknown'

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

function formatRemaining(totalSeconds) {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE

  if (minutes === 0) {
    return plural(seconds, 'second')
  }

  return seconds === 0
    ? plural(minutes, 'minute')
    : `${plural(minutes, 'minute')} and ${plural(seconds, 'second')}`
}

// Asks the server and says what the answer means. A redirect is not followed
// (the sign-in provider's address is not ours to fetch): it, or any 4xx, means
// the session has ended.
async function ask(url, init = {}) {
  let response

  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      ...init
    })
  } catch {
    return { outcome: UNKNOWN }
  }

  if (
    response.type === 'opaqueredirect' ||
    (response.status >= FIRST_CLIENT_ERROR &&
      response.status < FIRST_SERVER_ERROR)
  ) {
    return { outcome: ENDED }
  }

  if (!response.ok) {
    return { outcome: UNKNOWN }
  }

  try {
    return { outcome: CURRENT, times: await response.json() }
  } catch {
    return { outcome: UNKNOWN }
  }
}

function watch(dialog) {
  const extendForm = dialog.querySelector('[data-timeout-extend]')
  const overallNote = dialog.querySelector('[data-timeout-overall-note]')
  const remainingText = dialog.querySelector('[data-timeout-remaining]')
  const announcement = dialog.querySelector('[data-timeout-announcement]')
  const { statusUrl, signedOutUrl } = dialog.dataset

  let idleAt
  let maxAgeAt
  let warningMs
  let timer = null
  let ticker = null

  function applyTimes({ idleSeconds, maxAgeSeconds, warningSeconds }) {
    const now = Date.now()

    idleAt = now + idleSeconds * MS
    maxAgeAt = now + maxAgeSeconds * MS
    warningMs = warningSeconds * MS
  }

  const endsAt = () => Math.min(idleAt, maxAgeAt)
  const overallIsNearer = () => maxAgeAt <= idleAt

  function clearTimers() {
    clearTimeout(timer)
    clearInterval(ticker)
    timer = null
    ticker = null
  }

  // The signed-out page says which limit ended the session. Nothing is left
  // running once the person has been sent on.
  function leave() {
    stop()
    const reason = Date.now() >= maxAgeAt ? 'expired' : 'idle'
    window.location.assign(`${signedOutUrl}?reason=${reason}`)
  }

  // Applies an answer; false when the session has ended (and the person has
  // been sent on), so the caller stops.
  function apply({ outcome, times }) {
    if (outcome === ENDED) {
      leave()
      return false
    }

    if (outcome === CURRENT) {
      applyTimes(times)
    }

    return true
  }

  async function sync() {
    const answer = await ask(statusUrl)

    return { carryOn: apply(answer), outcome: answer.outcome }
  }

  function renderCountdown(secondsLeft, announce) {
    const text = formatRemaining(secondsLeft)

    remainingText.textContent = text

    if (announce) {
      announcement.textContent = `You will be signed out in ${text}.`
    }
  }

  function showWarning() {
    const overall = overallIsNearer()
    const first = Math.max(0, Math.ceil((endsAt() - Date.now()) / MS))

    extendForm.hidden = overall
    overallNote.hidden = !overall
    renderCountdown(first, true)

    if (!dialog.open) {
      dialog.showModal()
    }

    ticker = setInterval(tick, MS)
  }

  function hideWarning() {
    if (dialog.open) {
      dialog.close()
    }
  }

  function tick() {
    const secondsLeft = Math.max(0, Math.ceil((endsAt() - Date.now()) / MS))

    renderCountdown(secondsLeft, secondsLeft % ANNOUNCE_EVERY_SECONDS === 0)

    if (secondsLeft === 0) {
      confirmEnd().catch(leave)
    }
  }

  // Time is up by this clock: leave unless the server says another tab kept
  // the session alive.
  async function confirmEnd() {
    clearTimers()

    const { carryOn, outcome } = await sync()

    if (!carryOn) {
      return
    }

    if (outcome === CURRENT && Date.now() < endsAt()) {
      schedule()
      return
    }

    leave()
  }

  function schedule() {
    clearTimers()

    const now = Date.now()
    const warnAt = endsAt() - warningMs

    if (now >= endsAt()) {
      confirmEnd().catch(leave)
    } else if (now >= warnAt) {
      showWarning()
    } else {
      hideWarning()
      timer = setTimeout(checkThenSchedule, warnAt - now)
    }
  }

  // The warning time has come by this clock: check it is true first.
  async function checkThenSchedule() {
    timer = null

    const { carryOn } = await sync()

    if (carryOn) {
      schedule()
    }
  }

  async function extend() {
    const crumb = extendForm.querySelector('[name="crumb"]').value
    const answer = await ask(extendForm.action, {
      method: 'POST',
      body: new URLSearchParams({ crumb })
    })

    // Could not be asked: leave the warning open, the countdown goes on.
    if (answer.outcome !== UNKNOWN && apply(answer)) {
      schedule()
    }
  }

  function onSubmit(event) {
    event.preventDefault()
    extend()
  }

  // Escape does not dismiss the warning unseen: it is the same as staying
  // signed in, or does nothing when staying signed in cannot help.
  function onCancel(event) {
    event.preventDefault()

    if (!overallIsNearer()) {
      extend()
    }
  }

  async function onVisibilityChange() {
    // Timers run slowly in a hidden page: when it is shown again, find out.
    if (!document.hidden) {
      const { carryOn } = await sync()

      if (carryOn) {
        schedule()
      }
    }
  }

  function stop() {
    clearTimers()
    extendForm.removeEventListener('submit', onSubmit)
    dialog.removeEventListener('cancel', onCancel)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  applyTimes({
    idleSeconds: Number(dialog.dataset.idleSeconds),
    maxAgeSeconds: Number(dialog.dataset.maxAgeSeconds),
    warningSeconds: Number(dialog.dataset.warningSeconds)
  })
  extendForm.addEventListener('submit', onSubmit)
  dialog.addEventListener('cancel', onCancel)
  document.addEventListener('visibilitychange', onVisibilityChange)
  schedule()

  return stop
}

/**
 * Starts timing the session when the page has the timeout dialog.
 * @param {ParentNode} [root]
 * @returns {(() => void) | null} Stops timing, or null when there is no dialog.
 */
export function initSessionTimeout(root = document) {
  const dialog = root.querySelector(SELECTOR)

  return dialog ? watch(dialog) : null
}

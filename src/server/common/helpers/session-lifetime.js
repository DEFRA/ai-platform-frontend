import { config } from '#/config/config.js'
import { getSessionClock, setSessionClock } from './session.js'

const MS_PER_SECOND = 1000

/**
 * Starts the clock for a session that has just been signed in.
 * @param {object} request
 * @param {number} [now] epoch milliseconds
 */
export function startSessionClock(request, now = Date.now()) {
  setSessionClock(request, { startedAt: now, lastSeenAt: now })
}

/**
 * Records a request, so the idle time starts again. A session with no clock
 * is left without one: it has already ended.
 * @param {object} request
 * @param {number} [now] epoch milliseconds
 */
export function touchSession(request, now = Date.now()) {
  const clock = getSessionClock(request)

  if (clock) {
    setSessionClock(request, { ...clock, lastSeenAt: now })
  }
}

/**
 * Why a signed-in session has ended, or undefined while it has not. Either
 * limit ends it (design E #portal): `expired` is the overall limit and wins
 * when both have passed. A session with no clock fails closed as `expired`.
 * @param {object} request
 * @param {number} [now] epoch milliseconds
 * @returns {'idle' | 'expired' | undefined}
 */
export function sessionEndReason(request, now = Date.now()) {
  const remaining = sessionRemaining(request, now)

  if (!remaining || remaining.maxAgeMs === 0) {
    return 'expired'
  }

  return remaining.idleMs === 0 ? 'idle' : undefined
}

/**
 * What the browser needs to time the warning: whole seconds left on each
 * limit, and how long before the end the warning shows.
 * @param {object} request
 * @param {number} [now] epoch milliseconds
 * @returns {{ idleSeconds: number, maxAgeSeconds: number, warningSeconds: number } | undefined}
 */
export function sessionTimes(request, now = Date.now()) {
  const remaining = sessionRemaining(request, now)

  if (!remaining) {
    return undefined
  }

  return {
    idleSeconds: Math.ceil(remaining.idleMs / MS_PER_SECOND),
    maxAgeSeconds: Math.ceil(remaining.maxAgeMs / MS_PER_SECOND),
    warningSeconds: config.get('session.warningLeadMs') / MS_PER_SECOND
  }
}

/**
 * Milliseconds left before each limit ends the session, never below zero.
 * @param {object} request
 * @param {number} [now] epoch milliseconds
 * @returns {{ idleMs: number, maxAgeMs: number } | undefined}
 */
export function sessionRemaining(request, now = Date.now()) {
  const clock = getSessionClock(request)

  if (!clock) {
    return undefined
  }

  return {
    idleMs: Math.max(
      0,
      clock.lastSeenAt + config.get('session.idleTimeoutMs') - now
    ),
    maxAgeMs: Math.max(
      0,
      clock.startedAt + config.get('session.maxAgeMs') - now
    )
  }
}

import {
  startSessionClock,
  touchSession,
  sessionEndReason,
  sessionRemaining,
  sessionTimes
} from './session-lifetime.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const START = Date.parse('2026-11-04T09:00:00Z')

function mockRequest() {
  const store = {}

  return {
    yar: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value
      }
    }
  }
}

function signedInAt(now = START) {
  const request = mockRequest()
  startSessionClock(request, now)
  return request
}

describe('#session lifetime', () => {
  test('a new session has not ended', () => {
    expect(sessionEndReason(signedInAt(), START)).toBeUndefined()
  })

  test('stays signed in at 29 minutes idle and ends at 31', () => {
    const request = signedInAt()

    expect(sessionEndReason(request, START + 29 * MINUTE)).toBeUndefined()
    expect(sessionEndReason(request, START + 31 * MINUTE)).toBe('idle')
  })

  test('ends exactly at the idle limit', () => {
    expect(sessionEndReason(signedInAt(), START + 30 * MINUTE)).toBe('idle')
  })

  test('a request restarts the idle time', () => {
    const request = signedInAt()

    touchSession(request, START + 29 * MINUTE)

    expect(sessionEndReason(request, START + 58 * MINUTE)).toBeUndefined()
    expect(sessionEndReason(request, START + 60 * MINUTE)).toBe('idle')
  })

  test('ends 8 hours after sign-in however active the person has been', () => {
    const request = signedInAt()

    for (let minutes = 20; minutes < 8 * 60; minutes += 20) {
      touchSession(request, START + minutes * MINUTE)
    }

    expect(sessionEndReason(request, START + 8 * HOUR - MINUTE)).toBeUndefined()
    expect(sessionEndReason(request, START + 8 * HOUR)).toBe('expired')
  })

  test('says expired, not idle, when both limits have passed', () => {
    expect(sessionEndReason(signedInAt(), START + 9 * HOUR)).toBe('expired')
  })

  test('treats a session with no clock as ended, so it fails closed', () => {
    expect(sessionEndReason(mockRequest(), START)).toBe('expired')
    expect(sessionRemaining(mockRequest(), START)).toBeUndefined()
  })

  test('reports the time left on each limit, never below zero', () => {
    const request = signedInAt()

    expect(sessionRemaining(request, START + 10 * MINUTE)).toEqual({
      idleMs: 20 * MINUTE,
      maxAgeMs: 8 * HOUR - 10 * MINUTE
    })
    expect(sessionRemaining(request, START + 9 * HOUR)).toEqual({
      idleMs: 0,
      maxAgeMs: 0
    })
  })

  test('touching a session with no clock does not make one', () => {
    const request = mockRequest()

    touchSession(request, START)

    expect(sessionEndReason(request, START)).toBe('expired')
  })

  test('gives the browser whole seconds, rounded up, and the warning lead', () => {
    const request = signedInAt()

    expect(sessionTimes(request, START + 500)).toEqual({
      idleSeconds: 30 * 60,
      maxAgeSeconds: 8 * 60 * 60,
      warningSeconds: 120
    })
    expect(sessionTimes(mockRequest(), START)).toBeUndefined()
  })
})

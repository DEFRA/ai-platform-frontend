// Times for people are UK time (Europe/London), whatever the server's clock
// says, with no time zone library (plan D10).

const UK = 'Europe/London'

const wallClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric'
})

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  day: 'numeric',
  month: 'long',
  year: 'numeric'
})

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})

const MS_PER_SECOND = 1000

// How far UK time is ahead of UTC at an instant, in milliseconds.
function ukOffsetMs(instantMs) {
  const part = (type) =>
    Number(
      wallClock.formatToParts(instantMs).find((p) => p.type === type).value
    )
  const wallAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second')
  )

  return wallAsUtc - Math.floor(instantMs / MS_PER_SECOND) * MS_PER_SECOND
}

// The instant at which the UK clock shows these values. The second pass
// settles the hours either side of a clock change.
function ukInstant({ day, month, year }, [hour, minute, second, millisecond]) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  const first = wall - ukOffsetMs(wall)

  return new Date(wall - ukOffsetMs(first)).toISOString()
}

/**
 * The first instant of a UK day, as an ISO date-time.
 * @param {{day: number, month: number, year: number}} date
 * @returns {string}
 */
export function startOfUkDay(date) {
  return ukInstant(date, [0, 0, 0, 0])
}

/**
 * The last instant of a UK day, as an ISO date-time.
 * @param {{day: number, month: number, year: number}} date
 * @returns {string}
 */
export function endOfUkDay(date) {
  return ukInstant(date, [23, 59, 59, 999])
}

/**
 * The UK date of an instant, such as "30 October 2026".
 * @param {string} iso
 * @returns {string}
 */
export function formatUkDate(iso) {
  return dateFormat.format(new Date(iso))
}

/**
 * The UK time of an instant, such as "2:05pm".
 * @param {string} iso
 * @returns {string}
 */
export function formatUkTime(iso) {
  const parts = timeFormat.formatToParts(new Date(iso))
  const part = (type) => parts.find((p) => p.type === type).value

  return `${part('hour')}:${part('minute')}${part('dayPeriod').toLowerCase()}`
}

/**
 * The UK date and time of an instant, such as "30 October 2026, 2:05pm".
 * @param {string} iso
 * @returns {string}
 */
export function formatUkDateTime(iso) {
  return `${formatUkDate(iso)}, ${formatUkTime(iso)}`
}

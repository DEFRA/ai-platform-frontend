// What a person types for a limits change: two whole numbers, each within the
// bounds the backend gave for the environment. The page says what is wrong with
// each in words, with the bounds, and keeps what was typed; the backend checks
// the same bounds again, which is the check that counts.

const WHOLE_NUMBER = /^\d+$/
const numberFormat = new Intl.NumberFormat('en-GB')

const FIELDS = [
  { name: 'tokensPerMinute', label: 'Tokens a minute' },
  { name: 'requestsPerMinute', label: 'Requests a minute' }
]

// The text without the thousands separators and spaces people type, or null
// when it is not a whole number.
function wholeNumberOf(value) {
  const digits = String(value).trim().replaceAll(',', '')

  return WHOLE_NUMBER.test(digits) ? Number(digits) : null
}

function problemWith(field, raw, bounds) {
  const typed = String(raw ?? '').trim()

  if (typed === '') {
    return `Enter the ${field.label.toLowerCase()}`
  }

  const number = wholeNumberOf(typed)

  if (number === null) {
    return `${field.label} must be a whole number, such as 2000`
  }

  const { min, max } = bounds?.[field.name] ?? {}

  if (bounds && (number < min || number > max)) {
    return `${field.label} must be between ${numberFormat.format(min)} and ${numberFormat.format(max)}`
  }

  return null
}

/**
 * The limits a person typed, as numbers, or what is wrong with them.
 * @param {{tokensPerMinute?: string, requestsPerMinute?: string}} raw
 * @param {{tokensPerMinute: {min: number, max: number}, requestsPerMinute: {min: number, max: number}} | null} bounds
 * @returns {{limits: {tokensPerMinute: number, requestsPerMinute: number}} | {problems: {errorSummary: Array<{text: string, href: string}>, fieldErrors: Record<string, {text: string}>, values: object}}}
 */
export function parseLimits(raw, bounds) {
  const found = FIELDS.map((field) => ({
    field,
    text: problemWith(field, raw?.[field.name], bounds)
  })).filter(({ text }) => text !== null)

  if (found.length === 0) {
    return {
      limits: Object.fromEntries(
        FIELDS.map(({ name }) => [name, wholeNumberOf(raw[name])])
      )
    }
  }

  return {
    problems: {
      errorSummary: found.map(({ field, text }) => ({
        text,
        href: `#${field.name}`
      })),
      fieldErrors: Object.fromEntries(
        found.map(({ field, text }) => [field.name, { text }])
      ),
      values: Object.fromEntries(
        FIELDS.map(({ name }) => [name, String(raw?.[name] ?? '')])
      )
    }
  }
}

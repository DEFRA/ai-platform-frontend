import { isBadPage } from '#/server/common/helpers/pagination.js'
import { endOfUkDay, startOfUkDay } from '#/server/common/helpers/uk-time.js'
import { ADMIN_AUDIT_URL } from './admin-page.js'
import { ACTOR_TYPES } from './audit-labels.js'

// What the backend accepts of a Person, so the page can say so before asking.
export const MIN_PERSON_LENGTH = 2
export const MAX_PERSON_LENGTH = 100

const TEXT_FIELDS = ['team', 'environment', 'person', 'action', 'actorType']
const DATE_PARTS = ['day', 'month', 'year']
const DATE_LABELS = { from: 'From date', to: 'To date' }
const YEAR_LENGTH = 4

// Where an error summary link goes when no single field is at fault (a page
// number, a query the backend refused): the form, whose heading takes focus.
export const FORM_ANCHOR = '#filter-heading'

const PAGE_MESSAGE =
  'The page number must be a whole number, 1 or more. Filter again to start from the first page'

// One value, trimmed; nothing when it is missing, blank or given twice.
function single(query, name) {
  const value = query[name]

  return typeof value === 'string' ? value.trim() : ''
}

function readParts(query, name) {
  return Object.fromEntries(
    DATE_PARTS.map((part) => [part, single(query, `${name}-${part}`)])
  )
}

function joinWords(words) {
  return words.length === 2 ? `${words[0]} and ${words[1]}` : words[0]
}

// Whether the three parts name a day that exists.
function realDate({ day, month, year }) {
  if (
    !/^\d{1,2}$/.test(day) ||
    !/^\d{1,2}$/.test(month) ||
    year.length !== YEAR_LENGTH ||
    !/^\d+$/.test(year)
  ) {
    return null
  }

  const date = { day: Number(day), month: Number(month), year: Number(year) }
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day))
  const isReal =
    check.getUTCFullYear() === date.year &&
    check.getUTCMonth() === date.month - 1 &&
    check.getUTCDate() === date.day

  return isReal ? date : null
}

// A date typed in three parts: nothing, a real date, or what is wrong.
function readDate(name, parts) {
  const label = DATE_LABELS[name]
  const given = DATE_PARTS.filter((part) => parts[part] !== '')

  if (given.length === 0) {
    return { date: null }
  }

  const missing = DATE_PARTS.filter((part) => parts[part] === '')

  if (missing.length > 0) {
    return {
      error: {
        name,
        text: `${label} must include a ${joinWords(missing)}`,
        parts: missing,
        anchor: missing[0]
      }
    }
  }

  const date = realDate(parts)

  return date
    ? { date }
    : {
        error: {
          name,
          text: `${label} must be a real date`,
          parts: DATE_PARTS,
          anchor: 'day'
        }
      }
}

function dayNumber({ day, month, year }) {
  return Date.UTC(year, month - 1, day)
}

function personError(person) {
  const wrongLength =
    person &&
    (person.length < MIN_PERSON_LENGTH || person.length > MAX_PERSON_LENGTH)

  return wrongLength
    ? {
        field: 'person',
        text: `Person must be ${MIN_PERSON_LENGTH} to ${MAX_PERSON_LENGTH} characters`,
        href: '#person'
      }
    : null
}

// What the backend accepts of the selects' values, so a value it would refuse
// is said on its own field before it is sent.
const MAX_TEAM_LENGTH = 100
const MAX_ACTION_LENGTH = 64
const ENVIRONMENT_PATTERN = /^[a-z0-9-]{1,40}$/
const ACTION_PATTERN = /^[a-z][A-Za-z]*(\.[a-z][A-Za-z]*){1,3}$/

const SELECT_RULES = [
  {
    field: 'team',
    text: 'Choose a team from the list',
    valid: (value) => value.length <= MAX_TEAM_LENGTH
  },
  {
    field: 'environment',
    text: 'Choose an environment from the list',
    valid: (value) => ENVIRONMENT_PATTERN.test(value)
  },
  {
    field: 'action',
    text: 'Choose an action from the list',
    valid: (value) =>
      value.length <= MAX_ACTION_LENGTH && ACTION_PATTERN.test(value)
  },
  {
    field: 'actorType',
    text: 'Choose an actor type from the list',
    valid: (value) => ACTOR_TYPES.some((type) => type.value === value)
  }
]

function selectErrors(filters) {
  return SELECT_RULES.filter(
    ({ field, valid }) => filters[field] && !valid(filters[field])
  ).map(({ field, text }) => ({ field, text, href: `#${field}` }))
}

function dateErrors(from, to) {
  const errors = [from.error, to.error].filter(Boolean)

  if (errors.length === 0 && from.date && to.date) {
    if (dayNumber(from.date) > dayNumber(to.date)) {
      errors.push({
        name: 'to',
        text: 'To date must be the same as or after the From date',
        parts: DATE_PARTS,
        anchor: 'day'
      })
    }
  }

  return errors
}

function collectErrors({ filters, page, from, to }) {
  const rest = dateErrors(from, to)
  const errors = [
    ...selectErrors(filters),
    personError(filters.person),
    ...rest.map((error) => ({
      field: error.name,
      text: error.text,
      href: `#${error.name}-${error.anchor}`,
      parts: error.parts
    })),
    isBadPage(page)
      ? { field: null, text: PAGE_MESSAGE, href: FORM_ANCHOR }
      : null
  ].filter(Boolean)

  if (errors.length === 0) {
    return null
  }

  return {
    errorSummary: errors.map(({ text, href }) => ({ text, href })),
    fieldErrors: Object.fromEntries(
      errors
        .filter(({ field }) => field)
        .map(({ field, text }) => [field, { text }])
    ),
    dateErrors: Object.fromEntries(
      errors
        .filter(({ parts }) => parts)
        .map(({ field, parts }) => [field, parts])
    )
  }
}

/**
 * What the person asked for, read from the page's query: the filters as typed
 * (to show again), the query to send the backend (only what the log takes, UK
 * days turned into instants), and what is wrong with it, if anything. The
 * backend still checks everything; this says which field is wrong before it
 * is asked, for what the page can tell (plan D10).
 * @param {Record<string, unknown>} query - The request's query.
 * @returns {{
 *   filters: object,
 *   apiQuery: string | null,
 *   errors: {errorSummary: object[], fieldErrors: object, dateErrors: object} | null
 * }}
 */
export function readAuditQuery(query) {
  const filters = {
    ...Object.fromEntries(
      TEXT_FIELDS.map((name) => [name, single(query, name)])
    ),
    from: readParts(query, 'from'),
    to: readParts(query, 'to')
  }
  const rawPage = single(query, 'page')
  const page = rawPage === '' ? undefined : rawPage
  const from = readDate('from', filters.from)
  const to = readDate('to', filters.to)
  const errors = collectErrors({ filters, page, from, to })

  if (errors) {
    return { filters, apiQuery: null, errors }
  }

  const params = new URLSearchParams()

  for (const name of ['team', 'environment', 'person', 'action', 'actorType']) {
    if (filters[name]) {
      params.set(name, filters[name])
    }
  }

  if (from.date) {
    params.set('from', startOfUkDay(from.date))
  }

  if (to.date) {
    params.set('to', endOfUkDay(to.date))
  }

  if (page) {
    params.set('page', page)
  }

  return { filters, apiQuery: params.toString(), errors: null }
}

/**
 * The filters as the form's field names, without what is empty.
 * @param {{from: object, to: object} & Record<string, string>} filters
 * @returns {Record<string, string>}
 */
export function auditFormQuery(filters) {
  const entries = [
    ...TEXT_FIELDS.map((name) => [name, filters[name]]),
    ...['from', 'to'].flatMap((name) =>
      DATE_PARTS.map((part) => [`${name}-${part}`, filters[name]?.[part]])
    )
  ]

  return Object.fromEntries(entries.filter(([, value]) => value))
}

/**
 * The address of a page of the audit log with the filters given.
 * @param {object} filters
 * @param {number} [page]
 * @returns {string}
 */
export function auditUrl(filters, page = 1) {
  const params = new URLSearchParams(auditFormQuery(filters))

  if (page > 1) {
    params.set('page', String(page))
  }

  const text = params.toString()

  return text ? `${ADMIN_AUDIT_URL}?${text}` : ADMIN_AUDIT_URL
}

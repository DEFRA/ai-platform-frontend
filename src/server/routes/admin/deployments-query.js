import { isBadPage } from '#/server/common/helpers/pagination.js'
import { ADMIN_DEPLOYMENTS_URL } from './admin-page.js'
import { CREDENTIAL_FILTERS, STATUS_FILTERS } from './deployment-labels.js'

// What the backend accepts in the list's query, so the page can say which
// part it refused before asking.
export const MIN_SEARCH_LENGTH = 2
export const MAX_SEARCH_LENGTH = 100
const MAX_MODEL_LENGTH = 100
const ENVIRONMENT_PATTERN = /^[a-z0-9-]{1,40}$/

// The order the query is sent and kept in.
const FIELDS = ['environment', 'search', 'model', 'status', 'credential']

// Where an error summary link goes when no single field is at fault (the
// environment, which is a tab, not a field): the form, whose heading takes
// focus.
export const FORM_ANCHOR = '#filter-heading'

const PAGE_MESSAGE =
  'The page number must be a whole number, 1 or more. Filter again to start from the first page'

// One value, trimmed; nothing when it is missing, blank or given twice.
function single(query, name) {
  const value = query[name]

  return typeof value === 'string' ? value.trim() : ''
}

function isChoice(choices, value) {
  return choices.some((choice) => choice.value === value)
}

const RULES = [
  {
    field: 'search',
    text: `Search must be ${MIN_SEARCH_LENGTH} to ${MAX_SEARCH_LENGTH} characters`,
    href: '#search',
    valid: ({ length }) =>
      length >= MIN_SEARCH_LENGTH && length <= MAX_SEARCH_LENGTH
  },
  {
    field: 'model',
    text: 'Choose a model from the list',
    href: '#model',
    valid: ({ length }) => length <= MAX_MODEL_LENGTH
  },
  {
    field: 'status',
    text: 'Choose a status from the list',
    href: '#status',
    valid: (value) => isChoice(STATUS_FILTERS, value)
  },
  {
    field: 'credential',
    text: 'Choose a credential from the list',
    href: '#credential',
    valid: (value) => isChoice(CREDENTIAL_FILTERS, value)
  },
  {
    field: 'environment',
    text: 'Choose an environment from the tabs',
    href: FORM_ANCHOR,
    onField: false,
    valid: (value) => ENVIRONMENT_PATTERN.test(value)
  }
]

function collectErrors(filters, page) {
  const errors = [
    ...RULES.filter(
      ({ field, valid }) => filters[field] && !valid(filters[field])
    ),
    ...(isBadPage(page)
      ? [{ field: null, text: PAGE_MESSAGE, href: '#search' }]
      : [])
  ]

  if (errors.length === 0) {
    return null
  }

  return {
    errorSummary: errors.map(({ text, href }) => ({ text, href })),
    fieldErrors: Object.fromEntries(
      errors
        .filter(({ field, onField }) => field && onField !== false)
        .map(({ field, text }) => [field, { text }])
    )
  }
}

/**
 * What the person asked for, read from the page's query: the filters as typed
 * (to show again), the query to send the backend (only what the list takes,
 * or null when something is wrong) and what is wrong, if anything. The
 * backend still checks everything; this says which field is wrong before it
 * is asked, for what the page can tell.
 * @param {Record<string, unknown>} query - The request's query.
 * @returns {{
 *   filters: Record<string, string>,
 *   apiQuery: string | null,
 *   errors: {errorSummary: object[], fieldErrors: object} | null
 * }}
 */
export function readDeploymentsQuery(query) {
  const filters = Object.fromEntries(
    FIELDS.map((name) => [name, single(query, name)])
  )
  const page = single(query, 'page') || undefined
  const errors = collectErrors(filters, page)

  if (errors) {
    return { filters, apiQuery: null, errors }
  }

  const params = new URLSearchParams(
    FIELDS.filter((name) => filters[name]).map((name) => [name, filters[name]])
  )

  if (page) {
    params.set('page', page)
  }

  return { filters, apiQuery: params.toString(), errors: null }
}

/**
 * The address of a page of the list with the environment and filters given.
 * @param {Record<string, string | undefined>} filters
 * @param {number} [page]
 * @returns {string}
 */
export function deploymentsUrl(filters, page = 1) {
  const params = new URLSearchParams(
    FIELDS.filter((name) => filters[name]).map((name) => [name, filters[name]])
  )

  if (page > 1) {
    params.set('page', String(page))
  }

  const text = params.toString()

  return text ? `${ADMIN_DEPLOYMENTS_URL}?${text}` : ADMIN_DEPLOYMENTS_URL
}

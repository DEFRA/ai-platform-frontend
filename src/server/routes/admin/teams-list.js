import { apiClient } from '#/server/common/helpers/api-client.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import { teamStatusTag } from '#/server/common/helpers/team-status.js'
import { ADMIN_TEAMS_URL, adminTeamUrl } from './admin-page.js'

// What the backend accepts in the list's query, so the page can say which
// part it refused.
export const MIN_SEARCH_LENGTH = 2
export const MAX_SEARCH_LENGTH = 100
export const STATUS_FILTERS = [
  { value: '', text: 'All statuses' },
  { value: 'active', text: 'Active' },
  { value: 'disabled', text: 'Disabled' },
  { value: 'pending-removal', text: 'Pending removal' }
]

const FIELDS = ['search', 'status', 'page']

/**
 * What the person asked for, as the backend is to be asked: only the three
 * things the list takes, and only when each is given as one value. The
 * backend checks them; nothing is decided here.
 * @param {Record<string, unknown>} query - The request's query.
 * @returns {{search?: string, status?: string, page?: string}}
 */
export function listQuery(query) {
  return Object.fromEntries(
    FIELDS.flatMap((field) => {
      const value = typeof query[field] === 'string' ? query[field].trim() : ''

      return value ? [[field, value]] : []
    })
  )
}

/**
 * The address of a page of the list with the filters given.
 * @param {{search?: string, status?: string}} filters
 * @param {number} [page]
 * @returns {string}
 */
export function listUrl({ search, status }, page = 1) {
  const params = new URLSearchParams()

  if (search) {
    params.set('search', search)
  }

  if (status) {
    params.set('status', status)
  }

  if (page > 1) {
    params.set('page', String(page))
  }

  const text = params.toString()

  return text ? `${ADMIN_TEAMS_URL}?${text}` : ADMIN_TEAMS_URL
}

// The page numbers to show: the first, the last, and the pages next to the
// current one, with a gap between where pages are left out.
function pageNumbers(page, pages) {
  const shown = [
    ...new Set([1, page - 1, page, page + 1, pages].filter(inRange(pages)))
  ].sort((a, b) => a - b)

  return shown.flatMap((number, index) =>
    index > 0 && number - shown[index - 1] > 1 ? [null, number] : [number]
  )
}

function inRange(pages) {
  return (number) => number >= 1 && number <= pages
}

/**
 * The GOV.UK pagination for the list, or null when one page holds everything.
 * @param {{page: number, pageSize: number, total: number}} result
 * @param {{search?: string, status?: string}} filters
 * @returns {object | null}
 */
export function buildPagination({ page, pageSize, total }, filters) {
  const pages = Math.ceil(total / pageSize)

  if (pages <= 1) {
    return null
  }

  const href = (number) => listUrl(filters, number)

  return {
    previous: page > 1 ? { href: href(page - 1) } : undefined,
    next: page < pages ? { href: href(page + 1) } : undefined,
    items: pageNumbers(page, pages).map((number) =>
      number === null
        ? { ellipsis: true }
        : { number, href: href(number), current: number === page }
    )
  }
}

/**
 * One row of the list.
 * @param {{id: string, name: string, status?: string, environments: string[], memberCount: number}} team
 * @returns {object}
 */
export function buildTeamRow(team) {
  return {
    name: team.name,
    href: adminTeamUrl(team),
    status: teamStatusTag(team.status),
    environments:
      team.environments.length > 0
        ? team.environments.map(environmentName).join(', ')
        : 'None',
    memberCount: team.memberCount
  }
}

/**
 * Reads a page of the teams for a Platform Admin.
 * @param {import('@hapi/hapi').Request} request
 * @param {{search?: string, status?: string, page?: string}} query
 * @returns {Promise<{rows: object[], page: number, pageSize: number, total: number}>}
 */
export async function loadAdminTeamList(request, query) {
  const params = new URLSearchParams(query).toString()
  const { teams, page, pageSize, total } = await apiClient(request).get(
    `/v1/admin/teams${params ? `?${params}` : ''}`
  )

  return { rows: teams.map(buildTeamRow), page, pageSize, total }
}

/**
 * What to tell the person when the backend refused the query, on the field it
 * is about. The backend decided; this only says which part is likely wrong.
 * @param {{search?: string, status?: string}} query
 * @returns {{errorSummary: object[], fieldErrors: object}}
 */
export function queryErrors({ search, status, page }) {
  const searchWrongLength =
    search &&
    (search.length < MIN_SEARCH_LENGTH || search.length > MAX_SEARCH_LENGTH)
  const statusUnknown =
    status && !STATUS_FILTERS.some(({ value }) => value === status)

  if (!searchWrongLength && !statusUnknown && isBadPage(page)) {
    // The page is not a field on the form, so the message links to the search
    // field: searching again starts from the first page.
    return {
      errorSummary: [{ text: BAD_PAGE_MESSAGE, href: '#search' }],
      fieldErrors: {}
    }
  }

  if (statusUnknown && !searchWrongLength) {
    const text = 'Choose a status from the list'

    return {
      errorSummary: [{ text, href: '#status' }],
      fieldErrors: { status: { text } }
    }
  }

  const text = `Search must be ${MIN_SEARCH_LENGTH} to ${MAX_SEARCH_LENGTH} characters`

  return {
    errorSummary: [{ text, href: '#search' }],
    fieldErrors: { search: { text } }
  }
}

const BAD_PAGE_MESSAGE =
  'The page number must be a whole number, 1 or more. Search again to start from the first page'

// A page that is given and is not a whole number of 1 or more, which is what
// the backend refuses.
function isBadPage(page) {
  if (page === undefined) {
    return false
  }

  const number = Number(page)

  return !Number.isInteger(number) || number < 1
}

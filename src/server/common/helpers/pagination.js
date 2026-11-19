// The page links the Platform Admin lists share (the Teams tab and the Audit
// log tab, plan D13). Each list says how to build the address of a page, so
// the filters it keeps stay its own.

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
 * The GOV.UK pagination for a list, or null when one page holds everything.
 * @param {{page: number, pageSize: number, total: number}} result
 * @param {(page: number) => string} href - The address of a page of the list.
 * @returns {object | null}
 */
export function buildPagination({ page, pageSize, total }, href) {
  const pages = Math.ceil(total / pageSize)

  if (pages <= 1) {
    return null
  }

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
 * Whether a page that was asked for is not a whole number of 1 or more, which
 * is what the backend refuses. Not asking for one is fine.
 * @param {string | undefined} page
 * @returns {boolean}
 */
export function isBadPage(page) {
  if (page === undefined) {
    return false
  }

  const number = Number(page)

  return !Number.isInteger(number) || number < 1
}

/** How many rows every table of the portal shows on one page. */
export const TABLE_PAGE_SIZE = 10

/**
 * One page of rows held in memory, for a table the portal builds itself (the
 * Platform Admin lists are paged by the backend and use the same size). A page
 * that is not a whole number of 1 or more is the first, and one past the last
 * is the last, so a table never shows an empty page.
 * @param {unknown[]} rows - Every row of the table.
 * @param {{page?: string, href: (page: number) => string, pageSize?: number}} options - `href` is the address of a page of the table.
 * @returns {{rows: unknown[], page: number, pageSize: number, total: number, first: number, last: number, pagination: object | null}}
 */
export function pageOfRows(
  rows,
  { page: requested, href, pageSize = TABLE_PAGE_SIZE }
) {
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = isBadPage(requested)
    ? 1
    : Math.min(Number(requested ?? 1), pages)
  const start = (page - 1) * pageSize
  const shown = rows.slice(start, start + pageSize)

  return {
    rows: shown,
    page,
    pageSize,
    total,
    first: shown.length > 0 ? start + 1 : 0,
    last: start + shown.length,
    pagination: buildPagination({ page, pageSize, total }, href)
  }
}

function plural(count, [one, many]) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * What to say when the page asked for is past the last: the backend answers
 * it with no rows and the real total, so there is no count to show over an
 * empty table, only where the pages are. Null when the page has rows or there
 * are none at all.
 * @param {object} options
 * @param {number} options.shown - How many rows the page has.
 * @param {number} options.page
 * @param {number} options.pageSize
 * @param {number} options.total
 * @param {[string, string]} options.nouns - What a row is called, one and many.
 * @param {(page: number) => string} options.href - The address of a page.
 * @returns {{page: number, summary: string, links: Array<{text: string, href: string}>} | null}
 */
export function pastEnd({ shown, page, pageSize, total, nouns, href }) {
  if (shown > 0 || total === 0) {
    return null
  }

  const pages = Math.ceil(total / pageSize)
  const links = [{ text: 'Go to page 1', href: href(1) }]

  if (pages > 1) {
    links.push({
      text: `Go to page ${pages} (the last page)`,
      href: href(pages)
    })
  }

  return {
    page,
    summary: `There ${total === 1 ? 'is' : 'are'} ${plural(total, nouns)} on ${plural(pages, ['page', 'pages'])}.`,
    links
  }
}

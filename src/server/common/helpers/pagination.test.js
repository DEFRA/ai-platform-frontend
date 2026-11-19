import {
  TABLE_PAGE_SIZE,
  buildPagination,
  isBadPage,
  pageOfRows
} from './pagination.js'

const href = (number) => `/list?page=${number}`

describe('#buildPagination', () => {
  test('Should be nothing when one page holds everything', () => {
    expect(buildPagination({ page: 1, pageSize: 25, total: 25 }, href)).toBe(
      null
    )
    expect(buildPagination({ page: 1, pageSize: 25, total: 0 }, href)).toBe(
      null
    )
  })

  test('Should offer Next and both pages for 26 items, with the address from the function given', () => {
    expect(buildPagination({ page: 1, pageSize: 25, total: 26 }, href)).toEqual(
      {
        previous: undefined,
        next: { href: '/list?page=2' },
        items: [
          { number: 1, href: '/list?page=1', current: true },
          { number: 2, href: '/list?page=2', current: false }
        ]
      }
    )
  })

  test('Should offer Previous on the last page and no Next', () => {
    const pagination = buildPagination(
      { page: 2, pageSize: 25, total: 30 },
      href
    )

    expect(pagination.previous).toEqual({ href: '/list?page=1' })
    expect(pagination.next).toBeUndefined()
  })

  test('Should leave a gap where pages are left out, but not for a single page', () => {
    const far = buildPagination({ page: 5, pageSize: 25, total: 250 }, href)
    const near = buildPagination({ page: 3, pageSize: 25, total: 125 }, href)

    expect(far.items.map((item) => item.number ?? '...')).toEqual([
      1,
      '...',
      4,
      5,
      6,
      '...',
      10
    ])
    expect(near.items.map((item) => item.number ?? '...')).toEqual([
      1, 2, 3, 4, 5
    ])
  })
})

describe('#isBadPage', () => {
  test.each([[undefined], ['1'], ['25']])('Should accept %s', (page) => {
    expect(isBadPage(page)).toBe(false)
  })

  test.each([['0'], ['abc'], ['-1'], ['1.5'], ['']])(
    'Should refuse "%s"',
    (page) => {
      expect(isBadPage(page)).toBe(true)
    }
  )
})

describe('#pageOfRows', () => {
  const rows = Array.from({ length: 23 }, (_, index) => `row ${index + 1}`)

  test('Should show 10 rows a page, whatever table it is for', () => {
    expect(TABLE_PAGE_SIZE).toBe(10)
    expect(pageOfRows(rows, { href }).rows).toHaveLength(10)
    expect(pageOfRows(rows, { href }).pageSize).toBe(10)
  })

  test('Should show the first page when none is asked for, with what it shows and the links', () => {
    const page = pageOfRows(rows, { href })

    expect(page.rows[0]).toBe('row 1')
    expect(page.rows[9]).toBe('row 10')
    expect(page).toMatchObject({ page: 1, total: 23, first: 1, last: 10 })
    expect(page.pagination.next).toEqual({ href: '/list?page=2' })
    expect(page.pagination.previous).toBeUndefined()
  })

  test('Should show the rows of the page asked for, and a shorter last page', () => {
    const second = pageOfRows(rows, { page: '2', href })
    const third = pageOfRows(rows, { page: '3', href })

    expect(second.rows[0]).toBe('row 11')
    expect(third.rows).toEqual(['row 21', 'row 22', 'row 23'])
    expect(third).toMatchObject({ page: 3, first: 21, last: 23 })
    expect(third.pagination.next).toBeUndefined()
  })

  test.each([['0'], ['abc'], ['-2'], ['1.5'], ['']])(
    'Should show the first page for "%s"',
    (page) => {
      expect(pageOfRows(rows, { page, href }).page).toBe(1)
    }
  )

  test('Should show the last page for one past the end, never an empty one', () => {
    const page = pageOfRows(rows, { page: '99', href })

    expect(page.page).toBe(3)
    expect(page.rows).toHaveLength(3)
  })

  test('Should offer no pagination, and no rows to count, when 10 or fewer rows hold everything', () => {
    expect(pageOfRows(rows.slice(0, 10), { href })).toMatchObject({
      total: 10,
      first: 1,
      last: 10,
      pagination: null
    })
    expect(pageOfRows([], { href })).toMatchObject({
      rows: [],
      total: 0,
      first: 0,
      last: 0,
      pagination: null
    })
  })
})

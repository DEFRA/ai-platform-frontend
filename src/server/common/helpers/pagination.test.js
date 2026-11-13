import { buildPagination, isBadPage } from './pagination.js'

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

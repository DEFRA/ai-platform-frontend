import { pastEnd } from './past-end.js'

const href = (page) => `/list?page=${page}`
const nouns = ['event', 'events']

describe('#pastEnd', () => {
  test('is nothing when the page has rows', () => {
    expect(
      pastEnd({ shown: 3, page: 2, pageSize: 25, total: 30, nouns, href })
    ).toBeNull()
  })

  test('is nothing when there are none at all', () => {
    expect(
      pastEnd({ shown: 0, page: 1, pageSize: 25, total: 0, nouns, href })
    ).toBeNull()
  })

  test('says how many there are and on how many pages, with links to the first and last', () => {
    expect(
      pastEnd({ shown: 0, page: 9, pageSize: 25, total: 51, nouns, href })
    ).toEqual({
      page: 9,
      summary: 'There are 51 events on 3 pages.',
      links: [
        { text: 'Go to page 1', href: '/list?page=1' },
        { text: 'Go to page 3 (the last page)', href: '/list?page=3' }
      ]
    })
  })

  test('says "is" and one for one row on one page, with one link', () => {
    const result = pastEnd({
      shown: 0,
      page: 2,
      pageSize: 25,
      total: 1,
      nouns,
      href
    })

    expect(result.summary).toBe('There is 1 event on 1 page.')
    expect(result.links).toHaveLength(1)
  })
})

import {
  buildPagination,
  buildTeamRow,
  listQuery,
  listUrl,
  queryErrors
} from './teams-list.js'

describe('#listQuery', () => {
  test('Should keep only the search, status and page, trimmed', () => {
    expect(
      listQuery({ search: '  flood ', status: 'active', page: '2', other: 'x' })
    ).toEqual({ search: 'flood', status: 'active', page: '2' })
  })

  test('Should leave out what is empty, blank or not a single value', () => {
    expect(
      listQuery({ search: '', status: ['active', 'disabled'], page: '   ' })
    ).toEqual({})
  })
})

describe('#listUrl', () => {
  test('Should be the list itself with no filters on the first page', () => {
    expect(listUrl({})).toBe('/admin/teams')
    expect(listUrl({}, 1)).toBe('/admin/teams')
  })

  test('Should carry the filters, encoded, and the page after the first', () => {
    expect(listUrl({ search: 'a&b c', status: 'pending-removal' }, 3)).toBe(
      '/admin/teams?search=a%26b+c&status=pending-removal&page=3'
    )
  })
})

describe('#buildPagination', () => {
  const filters = { search: 'flood' }

  test('Should be nothing when one page holds every team', () => {
    expect(buildPagination({ page: 1, pageSize: 25, total: 25 }, filters)).toBe(
      null
    )
    expect(buildPagination({ page: 1, pageSize: 25, total: 0 }, filters)).toBe(
      null
    )
  })

  test('Should offer Next and the two pages for 26 teams', () => {
    expect(
      buildPagination({ page: 1, pageSize: 25, total: 26 }, filters)
    ).toEqual({
      previous: undefined,
      next: { href: '/admin/teams?search=flood&page=2' },
      items: [
        { number: 1, href: '/admin/teams?search=flood', current: true },
        {
          number: 2,
          href: '/admin/teams?search=flood&page=2',
          current: false
        }
      ]
    })
  })

  test('Should offer Previous on the last page and no Next', () => {
    const pagination = buildPagination(
      { page: 2, pageSize: 25, total: 30 },
      filters
    )

    expect(pagination.previous).toEqual({ href: '/admin/teams?search=flood' })
    expect(pagination.next).toBeUndefined()
  })

  test('Should leave a gap where pages are left out', () => {
    const pagination = buildPagination(
      { page: 5, pageSize: 25, total: 250 },
      {}
    )

    expect(pagination.items.map((item) => item.number ?? '...')).toEqual([
      1,
      '...',
      4,
      5,
      6,
      '...',
      10
    ])
    expect(pagination.items.find((item) => item.current).number).toBe(5)
  })

  test('Should not leave a gap for a single page left out', () => {
    const pagination = buildPagination(
      { page: 3, pageSize: 25, total: 125 },
      {}
    )

    expect(pagination.items.map((item) => item.number ?? '...')).toEqual([
      1, 2, 3, 4, 5
    ])
  })
})

describe('#buildTeamRow', () => {
  test('Should give a link by id, the status tag, environments by name and the members', () => {
    expect(
      buildTeamRow({
        id: 'team 1',
        name: 'Flood Risk Team',
        status: 'disabled',
        environments: ['infradev', 'prod'],
        memberCount: 3
      })
    ).toEqual({
      name: 'Flood Risk Team',
      href: '/admin/teams/team%201',
      status: { text: 'Disabled', classes: 'govuk-tag--grey' },
      environments: 'Development, Production',
      memberCount: 3
    })
  })

  test('Should say None for a team in no environment and read no status as active', () => {
    const row = buildTeamRow({
      id: 't',
      name: 'T',
      environments: [],
      memberCount: 0
    })

    expect(row.environments).toBe('None')
    expect(row.status.text).toBe('Active')
  })
})

describe('#queryErrors', () => {
  test.each([['a'], ['x'.repeat(101)]])(
    'Should put a search of the wrong length on the search field',
    (search) => {
      const { errorSummary, fieldErrors } = queryErrors({ search })

      expect(errorSummary).toEqual([
        { text: 'Search must be 2 to 100 characters', href: '#search' }
      ])
      expect(fieldErrors.search.text).toBe('Search must be 2 to 100 characters')
    }
  )

  test('Should put a status that is not offered on the status field', () => {
    const { errorSummary, fieldErrors } = queryErrors({
      search: 'flood',
      status: 'gone'
    })

    expect(errorSummary).toEqual([
      { text: 'Choose a status from the list', href: '#status' }
    ])
    expect(fieldErrors.status.text).toBe('Choose a status from the list')
  })

  test.each([['0'], ['abc'], ['-1'], ['1.5']])(
    'Should say the page number is wrong, not the search, when page is %s',
    (page) => {
      const { errorSummary, fieldErrors } = queryErrors({ page })

      expect(errorSummary[0].text).toContain('The page number must be a whole')
      expect(errorSummary[0].text).not.toContain('Search must be')
      expect(errorSummary[0].href).toBe('#search')
      expect(fieldErrors).toEqual({})
    }
  )

  test('Should blame the search before the page when both are wrong', () => {
    expect(queryErrors({ search: 'a', page: '0' }).errorSummary[0].text).toBe(
      'Search must be 2 to 100 characters'
    )
  })

  test('Should still say something on the search field when no cause can be found', () => {
    expect(queryErrors({ search: 'flood' }).errorSummary[0].href).toBe(
      '#search'
    )
  })
})

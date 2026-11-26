import { filterBarOf, periodSelectOf, teamSelectOf } from './filter-bar.js'

describe('#periodSelectOf', () => {
  test('offers 7, 30 and 90 days with the current one selected', () => {
    expect(periodSelectOf(30)).toEqual({
      id: 'days',
      name: 'days',
      label: 'Period',
      items: [
        { value: '7', text: 'Last 7 days', selected: false },
        { value: '30', text: 'Last 30 days', selected: true },
        { value: '90', text: 'Last 90 days', selected: false }
      ]
    })
  })
})

describe('#teamSelectOf', () => {
  test('lists the teams by name with the current one selected', () => {
    const teams = [
      { slug: 'a-team', name: 'A Team' },
      { slug: 'b-team', name: 'B Team' }
    ]

    expect(teamSelectOf(teams, 'b-team').items).toEqual([
      { value: 'a-team', text: 'A Team', selected: false },
      { value: 'b-team', text: 'B Team', selected: true }
    ])
  })
})

describe('#filterBarOf', () => {
  test('keeps the hidden choices and says how a keyboard applies one', () => {
    const bar = filterBarOf({
      action: '/usage',
      selects: [],
      hidden: [{ name: 'view', value: 'costs' }]
    })

    expect(bar.hidden).toEqual([{ name: 'view', value: 'costs' }])
    expect(bar.hint).toContain('press Enter')
  })

  test('uses a hint a page words for itself', () => {
    expect(
      filterBarOf({ action: '/', selects: [], hint: 'Pick one.' }).hint
    ).toBe('Pick one.')
  })
})

import { selectItems } from './select-items.js'

describe('#selectItems', () => {
  const choices = [
    { value: 'a', text: 'Alpha' },
    { value: 'b', text: 'Beta' }
  ]

  test('starts with the item that means all, selected when nothing is asked for', () => {
    expect(
      selectItems({
        all: 'All',
        choices,
        selected: '',
        unknownText: () => 'x'
      })
    ).toEqual([
      { value: '', text: 'All', selected: true },
      { value: 'a', text: 'Alpha', selected: false },
      { value: 'b', text: 'Beta', selected: false }
    ])
  })

  test('selects the choice asked for', () => {
    const items = selectItems({
      all: 'All',
      choices,
      selected: 'b',
      unknownText: () => 'x'
    })

    expect(items.filter(({ selected }) => selected)).toEqual([
      { value: 'b', text: 'Beta', selected: true }
    ])
  })

  test('adds a value that is asked for but not listed, so the form says what was asked', () => {
    const items = selectItems({
      all: 'All',
      choices,
      selected: 'z',
      unknownText: (value) => `Unknown ${value}`
    })

    expect(items.at(-1)).toEqual({
      value: 'z',
      text: 'Unknown z',
      selected: true
    })
  })
})

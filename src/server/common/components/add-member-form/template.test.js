import { renderComponent } from '#/test-helpers/component-helpers.js'

const base = {
  searchUrl: '/teams/flood/members/add/people',
  crumb: 'crumb-1',
  idempotencyKey: 'key-1',
  values: { search: '', role: 'user' },
  fieldErrors: {}
}

describe('Add member form component', () => {
  test('Should post with the CSRF token and the key of this add in hidden fields', () => {
    const $ = renderComponent('add-member-form', base)

    expect($('form').attr('method')).toBe('post')
    expect($('input[name="crumb"]').attr('value')).toBe('crumb-1')
    expect($('input[name="idempotencyKey"]').attr('value')).toBe('key-1')
  })

  test('Should tell the script where to search, and offer a Search button for no script', () => {
    const $ = renderComponent('add-member-form', {
      ...base,
      values: { ...base.values, query: 'pri' }
    })

    expect($('form').attr('data-people-search-url')).toBe(
      '/teams/flood/members/add/people'
    )
    expect($('input#search').attr('data-people-search')).toBeDefined()
    expect($('input#search').attr('data-people-query')).toBe('pri')
    expect($('[data-testid="search-people"]').text().trim()).toBe('Search')
    expect($('[data-testid="search-people"]').attr('value')).toBe('search')
  })

  test('Should keep the text searched for', () => {
    const $ = renderComponent('add-member-form', {
      ...base,
      values: { search: 'priya', role: 'user' }
    })

    expect($('input#search').attr('value')).toBe('priya')
  })

  test('Should offer the matches in a select list, saying how many there are', () => {
    const $ = renderComponent('add-member-form', {
      ...base,
      personCount: 2,
      personItems: [
        { value: '', text: 'Select a person' },
        { value: 'oid-1', text: 'Priya - priya@defra.gov.uk', selected: true },
        { value: 'oid-2', text: 'Tom - tom@defra.gov.uk' }
      ]
    })

    expect($('select#oid option')).toHaveLength(3)
    expect($('select#oid option:selected').attr('value')).toBe('oid-1')
    expect($('#oid-hint').text().trim()).toBe('2 people found')
  })

  test('Should say one person, not one people', () => {
    const $ = renderComponent('add-member-form', {
      ...base,
      personCount: 1,
      personItems: [{ value: 'oid-1', text: 'Priya' }]
    })

    expect($('#oid-hint').text().trim()).toBe('1 person found')
  })

  test('Should say no one was found, with what was searched for, when a search found no one', () => {
    const $ = renderComponent('add-member-form', {
      ...base,
      values: { search: 'zzz', role: 'user' },
      noMatches: true
    })

    expect($('select')).toHaveLength(0)
    expect($('[data-testid="no-people"]').text()).toContain(
      'No one found for ‘zzz’'
    )
  })

  test('Should show neither the list nor the empty message before a search', () => {
    const $ = renderComponent('add-member-form', base)

    expect($('select')).toHaveLength(0)
    expect($('[data-testid="no-people"]')).toHaveLength(0)
  })

  test('Should offer the roles, Member chosen, and an Add button', () => {
    const $ = renderComponent('add-member-form', base)

    expect($('input[name="role"]:checked').attr('value')).toBe('user')
    expect($('[data-testid="add-member-submit"]').attr('value')).toBe('add')
    expect($('.govuk-inset-text').text().trim()).toBe(
      'They can use the team straight away'
    )
  })

  test('Should show an error on each field it belongs to', () => {
    const $ = renderComponent('add-member-form', {
      ...base,
      personItems: [{ value: '', text: 'Select a person' }],
      personCount: 0,
      fieldErrors: {
        search: { text: 'Enter a name' },
        oid: { text: 'Select a person' },
        role: { text: 'Select a role' }
      }
    })

    expect(
      $('.govuk-error-message')
        .map((_, error) => $(error).text().replace(/\s+/g, ' ').trim())
        .get()
    ).toEqual([
      'Error: Enter a name',
      'Error: Select a person',
      'Error: Select a role'
    ])
  })
})

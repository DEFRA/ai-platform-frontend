import { renderComponent } from '#/test-helpers/component-helpers.js'

const rows = [
  {
    name: 'Test User (you)',
    email: 'test.user@defra.gov.uk',
    role: 'Admin',
    actionUrl: '/teams/flood/members/me/role',
    actionText: 'Change',
    actionHidden: 'role of Test User (you)'
  },
  { name: 'Tom Ellis', email: 't****@defra.gov.uk', role: 'Member' }
]

describe('Members table component', () => {
  test('Should list each member with name, email and role, and the caption for a screen reader', () => {
    const $ = renderComponent('members-table', {
      caption: 'Members of Flood Risk Team',
      rows
    })

    expect($('caption').text()).toBe('Members of Flood Risk Team')
    expect($('caption').hasClass('govuk-visually-hidden')).toBe(true)
    expect(
      $('thead th')
        .map((_, header) => $(header).text().trim())
        .get()
    ).toEqual(['Name', 'Email', 'Role'])
    expect(
      $('[data-testid="member-row"]')
        .map((_, row) =>
          $(row)
            .find('td')
            .map((__, cell) => $(cell).text().trim())
            .get()
        )
        .get()
    ).toEqual([
      'Test User (you)',
      'test.user@defra.gov.uk',
      'Admin',
      'Tom Ellis',
      't****@defra.gov.uk',
      'Member'
    ])
  })

  test('Should scroll inside a labelled region that a keyboard can reach, so the page itself never scrolls sideways', () => {
    const $ = renderComponent('members-table', {
      caption: 'Members of Flood Risk Team',
      rows
    })
    const $region = $('.app-table-scroll')

    expect($region.attr('role')).toBe('region')
    expect($region.attr('tabindex')).toBe('0')
    expect($region.attr('aria-label')).toBe('Members of Flood Risk Team')
    expect($region.find('table')).toHaveLength(1)
  })

  test('Should have no action column when it is not given a heading for one', () => {
    const $ = renderComponent('members-table', { caption: 'Members', rows })

    expect($('a')).toHaveLength(0)
    expect($('thead th')).toHaveLength(3)
  })

  test('Should add a column of links, each saying who it is for to a screen reader', () => {
    const $ = renderComponent('members-table', {
      caption: 'Members',
      rows,
      actionHeading: 'Change',
      actionTestId: 'member-change'
    })
    const $link = $('a[data-testid="member-change"]')

    expect($('thead th')).toHaveLength(4)
    expect($('thead th').last().text().trim()).toBe('Change')
    expect($link).toHaveLength(1)
    expect($link.attr('href')).toBe('/teams/flood/members/me/role')
    expect($link.text()).toBe('Change role of Test User (you)')
    expect($link.find('.govuk-visually-hidden').text()).toBe(
      ' role of Test User (you)'
    )
  })

  test('Should leave the cell empty for a member with no action', () => {
    const $ = renderComponent('members-table', {
      caption: 'Members',
      rows,
      actionHeading: 'Remove'
    })

    expect($('[data-testid="member-row"]').last().find('td')).toHaveLength(4)
    expect($('[data-testid="member-row"]').last().find('a')).toHaveLength(0)
    expect($('a').first().attr('data-testid')).toBe('member-action')
  })

  test('Should escape what a member is called', () => {
    const $ = renderComponent('members-table', {
      caption: 'Members',
      rows: [{ name: '<b>Bold</b>', email: 'a@b', role: 'Member' }]
    })

    expect($('td').first().html()).toBe('&lt;b&gt;Bold&lt;/b&gt;')
  })
})

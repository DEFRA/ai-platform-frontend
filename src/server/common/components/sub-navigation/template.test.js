import { renderComponent } from '#/test-helpers/component-helpers.js'

const items = [
  { text: 'Models', href: '/teams/flood/models', current: true },
  { text: 'Members', href: '/teams/flood/members' },
  { text: 'Details', href: '/teams/flood/details' }
]

describe('Sub-navigation component', () => {
  test('Should render a labelled navigation with a link for each item, in order', () => {
    const $nav = renderComponent('sub-navigation', { items, label: 'Team' })
    const $links = $nav('a')

    expect($nav('nav').attr('aria-label')).toBe('Team')
    expect($links.map((_, link) => $nav(link).text()).get()).toEqual([
      'Models',
      'Members',
      'Details'
    ])
    expect($links.map((_, link) => $nav(link).attr('href')).get()).toEqual([
      '/teams/flood/models',
      '/teams/flood/members',
      '/teams/flood/details'
    ])
  })

  test('Should name the navigation "Sub navigation" when no label is given', () => {
    const $nav = renderComponent('sub-navigation', { items })

    expect($nav('nav').attr('aria-label')).toBe('Sub navigation')
  })

  test('Should mark only the current link with aria-current="page" and the green bar', () => {
    const $nav = renderComponent('sub-navigation', { items })
    const $current = $nav('[aria-current="page"]')

    expect($current).toHaveLength(1)
    expect($current.text()).toBe('Models')
    expect($current.hasClass('app-sub-navigation__link--current')).toBe(true)
    expect(
      $current.parent().hasClass('app-sub-navigation__item--current')
    ).toBe(true)
  })

  test('Should show the other links as GOV.UK links', () => {
    const $nav = renderComponent('sub-navigation', { items })
    const $others = $nav('a:not([aria-current])')

    expect($others).toHaveLength(2)
    expect($others.first().hasClass('govuk-link')).toBe(true)
  })

  test('Should mark no link current when none is', () => {
    const $nav = renderComponent('sub-navigation', {
      items: items.map(({ current: _current, ...item }) => item)
    })

    expect($nav('[aria-current]')).toHaveLength(0)
  })

  test('Should escape link text', () => {
    const $nav = renderComponent('sub-navigation', {
      items: [{ text: '<b>x</b>', href: '/x' }]
    })

    expect($nav('b')).toHaveLength(0)
  })
})

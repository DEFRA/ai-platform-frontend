import { renderComponent } from '#/test-helpers/component-helpers.js'

const items = [
  {
    name: 'Infradev',
    displayName: 'Development',
    available: true,
    current: true,
    href: '/environments/flood/infradev'
  },
  {
    name: 'QA',
    displayName: 'Test',
    available: false,
    current: false,
    href: null
  },
  {
    name: 'PROD',
    displayName: 'Production',
    available: true,
    current: false,
    href: '/environments/flood/prod'
  }
]

describe('Environment strip component', () => {
  test('Should render a labelled navigation with a list item for each environment, in order', () => {
    const $strip = renderComponent('environment-strip', { items })

    expect($strip('nav').attr('aria-label')).toBe('Environments')
    expect($strip('li')).toHaveLength(3)
    expect(
      $strip('.app-environment-strip__name')
        .map((_, name) => $strip(name).text())
        .get()
    ).toEqual(['Infradev', 'QA', 'PROD'])
  })

  test('Should mark only the current environment with aria-current and its look', () => {
    const $strip = renderComponent('environment-strip', { items })

    expect($strip('[aria-current="page"]')).toHaveLength(1)
    expect($strip('[aria-current="page"]').attr('href')).toBe(
      '/environments/flood/infradev'
    )
    expect(
      $strip('li').first().hasClass('app-environment-strip__item--current')
    ).toBe(true)
  })

  test('Should link an available environment and give one that is not available yet no link, saying so', () => {
    const $strip = renderComponent('environment-strip', { items })
    const $unavailable = $strip('li').eq(1)

    expect($strip('a')).toHaveLength(2)
    expect($unavailable.find('a')).toHaveLength(0)
    expect(
      $unavailable.hasClass('app-environment-strip__item--unavailable')
    ).toBe(true)
    expect($unavailable.text()).toContain('Not available yet')
  })

  test('Should show the portal name under the registry name', () => {
    const $strip = renderComponent('environment-strip', { items })

    expect($strip('.app-environment-strip__display').first().text()).toBe(
      'Development'
    )
  })

  test('Should take its own accessible name and extra classes', () => {
    const $strip = renderComponent('environment-strip', {
      items,
      label: 'Flood environments',
      classes: 'extra'
    })

    expect($strip('nav').attr('aria-label')).toBe('Flood environments')
    expect($strip('nav').hasClass('extra')).toBe(true)
  })

  test('Should escape names', () => {
    const $strip = renderComponent('environment-strip', {
      items: [
        {
          name: '<b>x</b>',
          displayName: 'y',
          available: true,
          href: '/x'
        }
      ]
    })

    expect($strip('b')).toHaveLength(0)
  })

  test('Should render an empty list when there are no environments', () => {
    const $strip = renderComponent('environment-strip', { items: [] })

    expect($strip('li')).toHaveLength(0)
  })
})

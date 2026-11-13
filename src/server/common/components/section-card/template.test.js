import { renderComponent } from '#/test-helpers/component-helpers.js'

describe('Section card component', () => {
  test('Should wrap what it is given in a GOV.UK summary card under a level 2 title', () => {
    const $card = renderComponent(
      'section-card',
      { title: 'Models' },
      '<p class="inner">Body</p>'
    )

    expect($card('.govuk-summary-card')).toHaveLength(1)
    expect($card('.govuk-summary-card__title-wrapper > h2').text()).toBe(
      'Models'
    )
    expect($card('.govuk-summary-card__content .inner').text()).toBe('Body')
  })

  test('Should take the heading level, classes and attributes it is given', () => {
    const $card = renderComponent(
      'section-card',
      {
        title: 'Infradev',
        headingLevel: 3,
        classes: 'app-example',
        attributes: { 'data-testid': 'a-card' }
      },
      'Body'
    )

    expect($card('h3.govuk-summary-card__title').text()).toBe('Infradev')
    expect($card('h2')).toHaveLength(0)
    expect($card('[data-testid="a-card"]').hasClass('app-example')).toBe(true)
    expect($card('[data-testid="a-card"]').hasClass('app-section-card')).toBe(
      true
    )
  })

  test('Should put actions in a block beside the title, and leave it out when there are none', () => {
    const $with = renderComponent(
      'section-card',
      { title: 'Models', actionsHtml: '<a class="act" href="/x">Deploy</a>' },
      'Body'
    )
    const $without = renderComponent(
      'section-card',
      { title: 'Models' },
      'Body'
    )

    expect(
      $with('.govuk-summary-card__title-wrapper > .app-section-card__actions a')
    ).toHaveLength(1)
    expect($with('a.act').attr('href')).toBe('/x')
    expect($without('.app-section-card__actions')).toHaveLength(0)
  })

  test('Should escape the title', () => {
    const $card = renderComponent(
      'section-card',
      { title: '<b>Models</b>' },
      'Body'
    )

    expect($card('b')).toHaveLength(0)
    expect($card('.govuk-summary-card__title').text()).toBe('<b>Models</b>')
  })

  test('Should keep a card that scrolls as a named, keyboard-focusable region around its content', () => {
    const $card = renderComponent(
      'section-card',
      { title: 'Recent changes', scrollable: true },
      '<p class="inner">Body</p>'
    )
    const $region = $card(
      '.govuk-summary-card__content > .app-section-card__scroll'
    )

    expect($region).toHaveLength(1)
    expect($region.attr('tabindex')).toBe('0')
    expect($region.attr('role')).toBe('region')
    expect($region.attr('aria-label')).toBe('Recent changes')
    expect($region.find('.inner').text()).toBe('Body')
  })

  test('Should not add a scroll region unless asked', () => {
    const $card = renderComponent('section-card', { title: 'Models' }, 'Body')

    expect($card('.app-section-card__scroll')).toHaveLength(0)
    expect($card('[tabindex]')).toHaveLength(0)
  })
})

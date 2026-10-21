import { renderComponent } from '#/test-helpers/component-helpers.js'

const items = [
  { text: 'Request recorded', state: 'done', hint: '10:01' },
  { text: 'Setting up GPT-4o in Azure', state: 'current' },
  { text: 'Preparing your client secret', state: 'waiting', hint: 'Next' }
]

function labels($steps) {
  return $steps('[data-testid="step-list-item"]')
    .map((_, element) => $steps(element).find('.app-step-list__label').text())
    .get()
}

describe('Step list component', () => {
  test('Should render an ordered list with a step for each item, in order', () => {
    const $steps = renderComponent('step-list', { items })

    expect($steps('ol.app-step-list')).toHaveLength(1)
    expect(labels($steps)).toEqual([
      'Done: Request recorded',
      'In progress: Setting up GPT-4o in Azure',
      'Not started: Preparing your client secret'
    ])
  })

  test('Should mark each step done, current or waiting for its look', () => {
    const $steps = renderComponent('step-list', { items })
    const $items = $steps('[data-testid="step-list-item"]')

    expect($items.eq(0).hasClass('app-step-list__item--done')).toBe(true)
    expect($items.eq(1).hasClass('app-step-list__item--current')).toBe(true)
    expect($items.eq(2).hasClass('app-step-list__item--waiting')).toBe(true)
  })

  test('Should put visually hidden state text before each label and hide the circle from assistive technology', () => {
    const $steps = renderComponent('step-list', { items })
    const $first = $steps('[data-testid="step-list-item"]').first()

    expect($first.find('.govuk-visually-hidden').text()).toBe('Done: ')
    expect($first.find('.app-step-list__marker').attr('aria-hidden')).toBe(
      'true'
    )
  })

  test('Should mark only the current step with aria-current', () => {
    const $steps = renderComponent('step-list', { items })

    expect($steps('[aria-current="step"]')).toHaveLength(1)
    expect(
      $steps('[aria-current="step"]').hasClass('app-step-list__item--current')
    ).toBe(true)
  })

  test('Should show a hint under a label only when the step has one', () => {
    const $steps = renderComponent('step-list', { items })
    const $hints = $steps('.app-step-list__hint')

    expect($hints.map((_, hint) => $steps(hint).text()).get()).toEqual([
      '10:01',
      'Next'
    ])
  })

  test('Should show a step with an unknown state as not started', () => {
    const $steps = renderComponent('step-list', {
      items: [{ text: 'Odd', state: 'exploded' }]
    })

    expect(labels($steps)).toEqual(['Not started: Odd'])
  })

  test('Should escape text and hints and add any extra classes', () => {
    const $steps = renderComponent('step-list', {
      classes: 'extra',
      items: [{ text: '<b>Bold</b>', state: 'done', hint: '<i>x</i>' }]
    })

    expect($steps('ol').hasClass('extra')).toBe(true)
    expect($steps('b')).toHaveLength(0)
    expect($steps('i')).toHaveLength(0)
  })

  test('Should render an empty list when there are no steps', () => {
    const $steps = renderComponent('step-list', { items: [] })

    expect($steps('[data-testid="step-list-item"]')).toHaveLength(0)
  })
})

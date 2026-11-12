import { renderComponent } from '#/test-helpers/component-helpers.js'

describe('Copy value component', () => {
  test('Should show the value as text, readable with no script', () => {
    const $copy = renderComponent('copy-value', {
      id: 'client-id',
      value: '00000000-0000-0000-0000-000000000001',
      label: 'client ID'
    })

    expect($copy('#client-id').text()).toBe(
      '00000000-0000-0000-0000-000000000001'
    )
  })

  test('Should give a Copy button that is hidden until the script reveals it, and points at the value', () => {
    const $copy = renderComponent('copy-value', {
      id: 'client-id',
      value: 'abc',
      label: 'client ID'
    })
    const $button = $copy('button')

    expect($button.attr('type')).toBe('button')
    expect($button.attr('hidden')).toBeDefined()
    expect($button.attr('data-copy-target')).toBe('client-id')
  })

  test('Should name what is copied for a screen reader', () => {
    const $copy = renderComponent('copy-value', {
      id: 'tenant-id',
      value: 'abc',
      label: 'tenant ID'
    })

    expect($copy('button').text().replace(/\s+/g, ' ').trim()).toBe(
      'Copy tenant ID'
    )
    expect($copy('button .govuk-visually-hidden').text().trim()).toBe(
      'tenant ID'
    )
  })

  test('Should escape the value', () => {
    const $copy = renderComponent('copy-value', {
      id: 'x',
      value: '<b>x</b>',
      label: 'x'
    })

    expect($copy('#x b')).toHaveLength(0)
    expect($copy('#x').text()).toBe('<b>x</b>')
  })
})

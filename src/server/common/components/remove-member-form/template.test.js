import { renderComponent } from '#/test-helpers/component-helpers.js'

const params = {
  warningText: 'Removing someone does not change the client secret.',
  buttonText: 'Remove Priya Raman',
  cancelUrl: '/teams/flood/members',
  crumb: 'crumb-1'
}

describe('Remove member form component', () => {
  test('Should show the warning, in the box an error on the page points to', () => {
    const $ = renderComponent('remove-member-form', params)

    expect($('#remove-member .govuk-warning-text__text').text()).toContain(
      'Removing someone does not change the client secret.'
    )
    expect($('#remove-member .govuk-visually-hidden').text()).toBe('Warning')
  })

  test('Should post with the CSRF token', () => {
    const $ = renderComponent('remove-member-form', params)

    expect($('form').attr('method')).toBe('post')
    expect($('input[name="crumb"]').attr('value')).toBe('crumb-1')
  })

  test('Should have a red button naming the person, and a Cancel link', () => {
    const $ = renderComponent('remove-member-form', params)
    const $button = $('[data-testid="remove-member-confirm"]')

    expect($button.text().trim()).toBe('Remove Priya Raman')
    expect($button.hasClass('govuk-button--warning')).toBe(true)
    expect($('[data-testid="remove-member-cancel"]').attr('href')).toBe(
      '/teams/flood/members'
    )
  })
})

import { renderComponent } from '#/test-helpers/component-helpers.js'

describe('Role radios component', () => {
  test('Should offer Member and Admin, each saying what it can do', () => {
    const $ = renderComponent('role-radios', {})
    const $items = $('.govuk-radios__item')

    expect($('legend').text().trim()).toBe('Role')
    expect(
      $items.map((_, item) => $(item).find('label').text().trim()).get()
    ).toEqual(['Member', 'Admin'])
    expect($items.first().find('.govuk-hint').text()).toContain(
      'Can use the team’s models and add new ones'
    )
    expect($items.last().find('.govuk-hint').text()).toContain(
      'Can also see and rotate client secrets, add people, change roles and remove models'
    )
  })

  test('Should post the role as "user" or "admin"', () => {
    const $ = renderComponent('role-radios', {})

    expect(
      $('input[name="role"]')
        .map((_, input) => $(input).attr('value'))
        .get()
    ).toEqual(['user', 'admin'])
  })

  test('Should choose Member when no role is given', () => {
    const $ = renderComponent('role-radios', {})

    expect($('input:checked').attr('value')).toBe('user')
  })

  test('Should choose the role it is given', () => {
    const $ = renderComponent('role-radios', { value: 'admin' })

    expect($('input:checked').attr('value')).toBe('admin')
  })

  test('Should show an error on the field, with the first radio as its target', () => {
    const $ = renderComponent('role-radios', {
      errorMessage: { text: 'Select a role' }
    })

    expect($('.govuk-error-message').text()).toContain('Select a role')
    expect($('.govuk-form-group--error')).toHaveLength(1)
    expect($('input').first().attr('id')).toBe('role')
  })
})

import { renderComponent } from '#/test-helpers/component-helpers.js'

describe('Placeholder credential notice component', () => {
  test('Should say the client secret is a placeholder and why, in a GOV.UK inset', () => {
    const $notice = renderComponent('placeholder-credential-notice', {})
    const $inset = $notice('[data-testid="placeholder-credential-notice"]')

    expect($inset).toHaveLength(1)
    expect($inset.hasClass('govuk-inset-text')).toBe(true)
    expect($inset.text()).toContain('This client secret is a placeholder.')
    expect($inset.text()).toContain('does not work with the gateway yet')
    expect($inset.text()).toContain('Microsoft Entra administrator')
  })
})

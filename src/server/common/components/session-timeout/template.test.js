import { renderComponent } from '#/test-helpers/component-helpers.js'

const params = {
  idleSeconds: 1800,
  maxAgeSeconds: 28800,
  warningSeconds: 120,
  crumb: 'crumb-1'
}

describe('Session timeout component', () => {
  let $

  beforeEach(() => {
    $ = renderComponent('session-timeout', params)
  })

  test('renders a closed dialog, so nothing shows without JavaScript', () => {
    const $dialog = $('dialog[data-module="app-session-timeout"]')

    expect($dialog).toHaveLength(1)
    expect($dialog.attr('open')).toBeUndefined()
  })

  test('names the dialog by its heading and describes it by the countdown text', () => {
    const $dialog = $('dialog')

    expect(
      $(`#${$dialog.attr('aria-labelledby')}`)
        .text()
        .trim()
    ).toBe('You are about to be signed out')
    expect($(`#${$dialog.attr('aria-describedby')}`).text()).toContain(
      'we will sign you out in'
    )
  })

  test('hands the times and addresses to the script', () => {
    const $dialog = $('dialog')

    expect($dialog.data('idle-seconds')).toBe(1800)
    expect($dialog.data('max-age-seconds')).toBe(28800)
    expect($dialog.data('warning-seconds')).toBe(120)
    expect($dialog.data('status-url')).toBe('/session/status')
    expect($dialog.data('signed-out-url')).toBe('/signed-out')
  })

  test('offers staying signed in as the primary action, posting with the CSRF token', () => {
    const $form = $('form[data-timeout-extend]')

    expect($form.attr('method')).toBe('post')
    expect($form.attr('action')).toBe('/session/extend')
    expect($form.find('input[name="crumb"]').val()).toBe('crumb-1')
    expect($form.find('button').text().trim()).toBe('Stay signed in')
    expect($form.find('button').hasClass('govuk-button')).toBe(true)
  })

  test('offers signing out as the secondary action, with the CSRF token', () => {
    const $form = $('form[action="/sign-out"]')

    expect($form.find('input[name="crumb"]').val()).toBe('crumb-1')
    expect($form.find('button').text().trim()).toBe('Sign out')
    expect($form.find('button').hasClass('govuk-button--secondary')).toBe(true)
  })

  test('has a polite live region for the countdown and a hidden note for the overall limit', () => {
    expect($('[data-timeout-announcement]').attr('role')).toBe('status')
    expect($('[data-timeout-announcement]').attr('aria-live')).toBe('polite')
    expect($('[data-timeout-overall-note]').attr('hidden')).toBeDefined()
  })
})

// jsdom is loaded by this file rather than as the Vitest environment, so a
// slow first load of it cannot hit the pool's fixed 60 second worker start limit.
import { JSDOM } from 'jsdom'

import { initTeamSwitcher } from './team-switcher.js'

const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/'
})
const { document } = window

function page() {
  document.body.innerHTML = `
    <form data-team-switcher method="get" action="/environments">
      <label for="team">Team</label>
      <select id="team" name="team">
        <option value="flood-risk-team" selected>Flood Risk Team</option>
        <option value="coastal-team">Coastal Team</option>
      </select>
    </form>`

  const form = document.querySelector('form')
  const submitted = vi.fn((event) => event.preventDefault())

  form.addEventListener('submit', submitted)
  initTeamSwitcher(document)

  return { form, select: document.getElementById('team'), submitted }
}

function choose(select, value) {
  select.value = value
  select.dispatchEvent(new window.Event('change', { bubbles: true }))
}

function key(select, name) {
  const event = new window.KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true
  })

  select.dispatchEvent(event)

  return event
}

describe('#initTeamSwitcher', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('switches team at once when a team is chosen with the pointer', () => {
    const { select, submitted } = page()

    select.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    choose(select, 'coastal-team')

    expect(submitted).toHaveBeenCalledTimes(1)
  })

  test('waits for Enter after typing the start of a team’s name, which also changes the choice', () => {
    const { select, submitted } = page()

    key(select, 'c')
    choose(select, 'coastal-team')

    expect(submitted).not.toHaveBeenCalled()

    key(select, 'Enter')

    expect(submitted).toHaveBeenCalledTimes(1)
  })

  test('does not treat a shortcut, such as Ctrl+A, as moving through the list', () => {
    const { select, submitted } = page()

    select.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true })
    )
    choose(select, 'coastal-team')

    expect(submitted).toHaveBeenCalledTimes(1)
  })

  test('does nothing when the team chosen is the one already shown', () => {
    const { select, submitted } = page()

    choose(select, 'flood-risk-team')

    expect(submitted).not.toHaveBeenCalled()
  })

  test('waits for Enter after the arrow keys, so passing through the list does not move the person', () => {
    const { select, submitted } = page()

    key(select, 'ArrowDown')
    choose(select, 'coastal-team')

    expect(submitted).not.toHaveBeenCalled()

    const enter = key(select, 'Enter')

    expect(enter.defaultPrevented).toBe(true)
    expect(submitted).toHaveBeenCalledTimes(1)
  })

  test('does not switch on Enter when no other team was chosen', () => {
    const { select, submitted } = page()

    key(select, 'Enter')

    expect(submitted).not.toHaveBeenCalled()
  })

  test('tells assistive technology how it works, adding to what already describes the select', () => {
    document.body.innerHTML = `
      <form data-team-switcher><select id="team" aria-describedby="existing">
        <option value="a" selected>A</option></select></form>`
    initTeamSwitcher(document)

    const select = document.getElementById('team')
    const hint = document.getElementById('team-switch-hint')

    expect(select.getAttribute('aria-describedby')).toBe(
      'existing team-switch-hint'
    )
    expect(hint.className).toBe('govuk-visually-hidden')
    expect(hint.textContent).toContain('press Enter')
  })

  test('leaves a form with no select alone', () => {
    document.body.innerHTML = '<form data-team-switcher></form>'

    expect(() => initTeamSwitcher(document)).not.toThrow()
  })

  test('applies each select of a data-auto-submit form, with the form’s own hint', () => {
    document.body.innerHTML = `
      <form data-auto-submit data-switch-hint="Choosing applies it.">
        <select id="team"><option value="a" selected>A</option><option value="b">B</option></select>
        <select id="days"><option value="7" selected>7</option><option value="30">30</option></select>
      </form>`

    const form = document.querySelector('form')
    const submitted = vi.fn((event) => event.preventDefault())

    form.addEventListener('submit', submitted)
    initTeamSwitcher(document)
    choose(document.getElementById('days'), '30')

    expect(submitted).toHaveBeenCalledTimes(1)
    expect(document.getElementById('team-switch-hint').textContent).toBe(
      'Choosing applies it.'
    )
    expect(document.getElementById('days-switch-hint')).not.toBeNull()
  })
})

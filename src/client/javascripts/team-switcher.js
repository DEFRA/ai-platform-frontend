// Progressive enhancement for the selectors that change what a page shows: the
// team on the Environments page, and the team, period and the like on the
// usage pages. Without script, the page shows a button (in a noscript element)
// that submits the form. With script the button is not needed: choosing an
// option with the pointer applies it at once.
//
// Choosing with the keyboard must not move the person away on every arrow
// press as they pass through the list (WCAG 3.2.2 On Input), so after an
// arrow key the change waits for Enter.

const FORM_SELECTOR = 'form[data-team-switcher], form[data-auto-submit]'
const MOVING_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])
const HINT =
  'Choosing a team opens its environments. With a keyboard, press Enter after choosing.'

// The hint is only true with script, so script adds it. A form can word it
// for what its selectors change (`data-switch-hint`).
function describe(select, text) {
  const hint = select.ownerDocument.createElement('span')

  hint.id = `${select.id}-switch-hint`
  hint.className = 'govuk-visually-hidden'
  hint.textContent = text
  select.after(hint)
  select.setAttribute(
    'aria-describedby',
    [select.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' ')
  )
}

// A key that moves through the list: the arrows and their kin, and a typed
// letter, which a select takes as "go to the option that starts with it".
function movesThroughList(event) {
  return (
    MOVING_KEYS.has(event.key) ||
    (event.key.length === 1 && !event.ctrlKey && !event.metaKey)
  )
}

function wire(form) {
  form.querySelectorAll('select').forEach((select) => wireSelect(form, select))
}

function wireSelect(form, select) {
  const current = select.value
  let usingKeyboard = false

  describe(select, form.dataset.switchHint ?? HINT)

  select.addEventListener('pointerdown', () => {
    usingKeyboard = false
  })

  select.addEventListener('keydown', (event) => {
    if (movesThroughList(event)) {
      usingKeyboard = true
      return
    }

    if (event.key === 'Enter' && select.value !== current) {
      event.preventDefault()
      form.requestSubmit()
    }
  })

  select.addEventListener('change', () => {
    if (!usingKeyboard && select.value !== current) {
      form.requestSubmit()
    }
  })
}

/**
 * Makes the selectors of a form apply when an option is chosen.
 * @param {ParentNode} [root]
 */
export function initTeamSwitcher(root = document) {
  root.querySelectorAll(FORM_SELECTOR).forEach(wire)
}

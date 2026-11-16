// Progressive enhancement for the team selector on the Environments page.
// Without script, the page shows a "Switch team" button (in a noscript
// element) that submits the form. With script the button is not needed:
// choosing a team with the pointer switches to it at once.
//
// Choosing with the keyboard must not move the person away on every arrow
// press as they pass through the list (WCAG 3.2.2 On Input), so after an
// arrow key the change waits for Enter.

const FORM_SELECTOR = 'form[data-team-switcher]'
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

// The hint is only true with script, so script adds it.
function describe(select) {
  const hint = select.ownerDocument.createElement('span')

  hint.id = `${select.id}-switch-hint`
  hint.className = 'govuk-visually-hidden'
  hint.textContent = HINT
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
  const select = form.querySelector('select')

  if (!select) {
    return
  }

  const current = select.value
  let usingKeyboard = false

  describe(select)

  select.addEventListener('pointerdown', () => {
    usingKeyboard = false
  })

  select.addEventListener('keydown', (event) => {
    if (movesThroughList(event)) {
      usingKeyboard = true
    } else if (event.key === 'Enter' && select.value !== current) {
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
 * Makes the team selector switch team when a team is chosen.
 * @param {ParentNode} [root]
 */
export function initTeamSwitcher(root = document) {
  root.querySelectorAll(FORM_SELECTOR).forEach(wire)
}

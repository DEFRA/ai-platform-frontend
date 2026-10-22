import {
  createAll,
  Button,
  CharacterCount,
  Checkboxes,
  ErrorSummary,
  Radios,
  ServiceNavigation,
  SkipLink,
  Tabs
} from 'govuk-frontend'

createAll(Button)
createAll(CharacterCount)
createAll(Checkboxes)
createAll(ErrorSummary)
createAll(Radios)
createAll(ServiceNavigation)
createAll(SkipLink)
createAll(Tabs)

// Progressive enhancement: reveal and wire up "Copy key" and "Copy code"
// buttons (hidden by default so the readonly key field and the code still
// work with no JavaScript). A field is copied by its value, code by its text.
document.querySelectorAll('[data-copy-target]').forEach((button) => {
  button.hidden = false
  button.addEventListener('click', () => {
    const source = document.getElementById(button.dataset.copyTarget)
    if (source) {
      navigator.clipboard?.writeText(source.value ?? source.textContent)
    }
  })
})

// Progressive enhancement: disable a submit button and show a spinner while
// its form is submitting, so a slow backend call (renew, revoke, issue a
// credential) can't be re-triggered by repeat clicks. Marked by
// `.app-button--loading-on-submit` in the view; a real form submission still
// navigates away once the server responds, so there's no "stuck" state to
// recover from - only bfcache restores (back/forward) need resetting.
document
  .querySelectorAll('.app-button--loading-on-submit')
  .forEach((button) => {
    const form = button.closest('form')
    if (!form) {
      return
    }

    form.addEventListener('submit', () => {
      if (button.disabled) {
        return
      }

      button.disabled = true

      const spinner = document.createElement('span')
      spinner.className = 'app-button__spinner'
      spinner.setAttribute('aria-hidden', 'true')
      button.append(spinner)

      const loadingText = document.createElement('span')
      loadingText.className = 'govuk-visually-hidden app-button__loading-text'
      loadingText.textContent = ' Loading'
      button.append(loadingText)
    })

    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        button.disabled = false
        button.querySelector('.app-button__spinner')?.remove()
        button.querySelector('.app-button__loading-text')?.remove()
      }
    })
  })

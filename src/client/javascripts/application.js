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

// Progressive enhancement: reveal and wire up "Copy key" buttons (hidden by
// default so the readonly key field still works with no JavaScript).
document.querySelectorAll('[data-copy-target]').forEach((button) => {
  button.hidden = false
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.copyTarget)
    if (input) {
      navigator.clipboard?.writeText(input.value)
    }
  })
})

// Progressive enhancement: let people stop the team-request page's
// auto-refresh (WCAG 2.2 SC 2.2.1 Timing Adjustable) - the meta-refresh
// removal and JS-driven timer live inline in connect/team/request.njk.
const stopRefreshButton = document.getElementById('app-stop-refresh')
if (stopRefreshButton) {
  stopRefreshButton.hidden = false
  stopRefreshButton.addEventListener('click', () => {
    window.appStopAutoRefresh?.()
    stopRefreshButton.disabled = true
    stopRefreshButton.textContent = 'Checking stopped'
  })
}

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

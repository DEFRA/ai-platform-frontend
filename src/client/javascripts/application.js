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

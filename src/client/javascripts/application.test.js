// jsdom is loaded by this file rather than as the Vitest environment, so a
// slow first load of it cannot hit the pool's fixed 60 second worker start limit.
import { JSDOM } from 'jsdom'

// GOV.UK Frontend is the real library, run against the page below. Only this
// repo's own two enhancement modules are replaced, so their calls can be seen.
const initProgressRefresh = vi.hoisted(() => vi.fn())
const initSessionTimeout = vi.hoisted(() => vi.fn())

vi.mock('./progress-refresh.js', () => ({ initProgressRefresh }))
vi.mock('./session-timeout.js', () => ({ initSessionTimeout }))

// What GOV.UK Frontend reads from the browser's global scope.
const BROWSER_GLOBALS = [
  'HTMLElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLFormElement',
  'HTMLAnchorElement',
  'HTMLTextAreaElement',
  'HTMLDialogElement',
  'HTMLDetailsElement',
  'HTMLSelectElement',
  'SVGElement',
  'Element',
  'Node',
  'NodeList',
  'Document',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'MutationObserver',
  'URL'
]

// Loads the page script against a page made of `body`, as a browser would
// after GOV.UK's own script has marked the page as supported.
async function loadPage(body, { clipboard } = {}) {
  const { window } = new JSDOM(
    `<!doctype html><html><body class="govuk-frontend-supported">${body}</body></html>`,
    { url: 'http://localhost/' }
  )

  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('navigator', { clipboard })

  for (const name of BROWSER_GLOBALS) {
    vi.stubGlobal(name, window[name])
  }

  vi.resetModules()
  await import('./application.js')

  return window
}

describe('application.js', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('GOV.UK Frontend components', () => {
    test('starts the components on the page: an error summary takes focus and a checkbox with a conditional reveal is wired to it', async () => {
      const window = await loadPage(`
        <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1" id="summary">
          <div role="alert"><h2>There is a problem</h2></div>
        </div>
        <div class="govuk-checkboxes" data-module="govuk-checkboxes">
          <div class="govuk-checkboxes__item">
            <input class="govuk-checkboxes__input" id="other" name="other" type="checkbox" data-aria-controls="reveal">
            <label class="govuk-label govuk-checkboxes__label" for="other">Other</label>
          </div>
          <div class="govuk-checkboxes__conditional govuk-checkboxes__conditional--hidden" id="reveal">More</div>
        </div>`)
      const { document } = window
      const input = document.getElementById('other')

      expect(document.activeElement).toBe(document.getElementById('summary'))
      expect(input.getAttribute('aria-controls')).toBe('reveal')
      expect(input.getAttribute('aria-expanded')).toBe('false')

      input.click()

      expect(input.getAttribute('aria-expanded')).toBe('true')
    })

    test('starts the progress refresh and the session timeout, once each', async () => {
      await loadPage('')

      expect(initProgressRefresh).toHaveBeenCalledTimes(1)
      expect(initSessionTimeout).toHaveBeenCalledTimes(1)
    })
  })

  describe('copy buttons', () => {
    const page =
      '<input id="key" value="the-key"><code id="code">the-code</code>' +
      '<button id="copy-key" hidden data-copy-target="key">Copy key</button>' +
      '<button id="copy-code" hidden data-copy-target="code">Copy code</button>' +
      '<button id="copy-none" hidden data-copy-target="missing">Copy</button>'

    test('reveals each button, which is hidden so the field and the code work without script', async () => {
      const window = await loadPage(page, { clipboard: { writeText: vi.fn() } })

      expect(window.document.getElementById('copy-key').hidden).toBe(false)
      expect(window.document.getElementById('copy-code').hidden).toBe(false)
    })

    test('copies a field by its value and code by its text', async () => {
      const writeText = vi.fn(async () => undefined)
      const window = await loadPage(page, { clipboard: { writeText } })

      window.document.getElementById('copy-key').click()
      window.document.getElementById('copy-code').click()
      await Promise.resolve()

      expect(writeText.mock.calls).toEqual([['the-key'], ['the-code']])
    })

    test('does nothing when what it copies is not on the page', async () => {
      const writeText = vi.fn()
      const window = await loadPage(page, { clipboard: { writeText } })

      window.document.getElementById('copy-none').click()
      await Promise.resolve()

      expect(writeText).not.toHaveBeenCalled()
    })

    test('leaves the text selectable when the browser refuses the copy, or has no clipboard', async () => {
      const refused = await loadPage(page, {
        clipboard: {
          writeText: vi.fn(async () => Promise.reject(new Error('no')))
        }
      })

      refused.document.getElementById('copy-key').click()
      await new Promise((resolve) => setTimeout(resolve))

      const none = await loadPage(page, { clipboard: undefined })

      none.document.getElementById('copy-key').click()
      await new Promise((resolve) => setTimeout(resolve))

      expect(none.document.getElementById('key').value).toBe('the-key')
    })
  })

  describe('buttons that show they are working', () => {
    const page =
      '<form id="form"><button id="go" type="button" class="app-button--loading-on-submit">Go</button></form>' +
      '<button id="loose" type="button" class="app-button--loading-on-submit">No form</button>'

    function submit(window) {
      window.document
        .getElementById('form')
        .dispatchEvent(new window.Event('submit'))
    }

    test('disables the button and shows a spinner and "Loading" for those who cannot see it, once', async () => {
      const window = await loadPage(page)
      const button = window.document.getElementById('go')

      submit(window)
      submit(window)

      expect(button.disabled).toBe(true)
      expect(button.querySelectorAll('.app-button__spinner')).toHaveLength(1)
      expect(
        button.querySelector('.app-button__loading-text').textContent
      ).toBe(' Loading')
      expect(
        button.querySelector('.app-button__spinner').getAttribute('aria-hidden')
      ).toBe('true')
    })

    test('leaves a button with no form alone', async () => {
      const window = await loadPage(page)

      expect(window.document.getElementById('loose').disabled).toBe(false)
    })

    test('puts the button back when the page is restored from the back-forward cache, and not otherwise', async () => {
      const window = await loadPage(page)
      const button = window.document.getElementById('go')

      submit(window)
      window.dispatchEvent(
        Object.assign(new window.Event('pageshow'), { persisted: false })
      )

      expect(button.disabled).toBe(true)

      window.dispatchEvent(
        Object.assign(new window.Event('pageshow'), { persisted: true })
      )

      expect(button.disabled).toBe(false)
      expect(button.querySelector('.app-button__spinner')).toBeNull()
      expect(button.querySelector('.app-button__loading-text')).toBeNull()
    })
  })
})

// jsdom is loaded by this file rather than as the Vitest environment, so a
// slow first load of it cannot hit the pool's fixed 60 second worker start limit.
import { JSDOM } from 'jsdom'

const components = vi.hoisted(() => ({
  createAll: vi.fn(),
  Button: 'Button',
  CharacterCount: 'CharacterCount',
  Checkboxes: 'Checkboxes',
  ErrorSummary: 'ErrorSummary',
  Radios: 'Radios',
  ServiceNavigation: 'ServiceNavigation',
  SkipLink: 'SkipLink',
  Tabs: 'Tabs'
}))
const initProgressRefresh = vi.hoisted(() => vi.fn())
const initSessionTimeout = vi.hoisted(() => vi.fn())

vi.mock('govuk-frontend', () => components)
vi.mock('./progress-refresh.js', () => ({ initProgressRefresh }))
vi.mock('./session-timeout.js', () => ({ initSessionTimeout }))

// Loads the page script against a page made of `body`, as a browser would.
async function loadPage(body, { clipboard } = {}) {
  const { window } = new JSDOM(
    `<!doctype html><html><body>${body}</body></html>`,
    {
      url: 'http://localhost/'
    }
  )

  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('navigator', { clipboard })
  vi.resetModules()
  await import('./application.js')

  return window
}

describe('application.js', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('starts each GOV.UK component, then the progress refresh and the session timeout', async () => {
    await loadPage('')

    expect(
      components.createAll.mock.calls.map(([component]) => component)
    ).toEqual([
      'Button',
      'CharacterCount',
      'Checkboxes',
      'ErrorSummary',
      'Radios',
      'ServiceNavigation',
      'SkipLink',
      'Tabs'
    ])
    expect(initProgressRefresh).toHaveBeenCalledTimes(1)
    expect(initSessionTimeout).toHaveBeenCalledTimes(1)
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
      '<form id="form"><button id="go" class="app-button--loading-on-submit">Go</button></form>' +
      '<button id="loose" class="app-button--loading-on-submit">No form</button>'

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

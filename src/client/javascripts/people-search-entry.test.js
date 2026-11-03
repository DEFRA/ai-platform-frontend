// jsdom is loaded by this file rather than as the Vitest environment, so a
// slow first load of it cannot hit the pool's fixed 60 second worker start limit.
import { JSDOM } from 'jsdom'

// accessible-autocomplete's browser bundle expects `self`, as a browser has.
vi.hoisted(() => {
  globalThis.self ??= globalThis
})

describe('people-search-entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  test('turns the add-member page’s field into a combobox when the script loads', async () => {
    const { window } = new JSDOM(
      `<form data-people-search-url="/teams/t/members/add/people">
        <input type="hidden" name="crumb" value="crumb-1">
        <div class="govuk-form-group">
          <label class="govuk-label" for="search">Name</label>
          <input id="search" name="search" data-people-search>
        </div>
      </form>`
    )

    vi.stubGlobal('document', window.document)
    vi.stubGlobal('window', window)

    await import('./people-search-entry.js')

    expect(window.document.querySelector('#search').getAttribute('role')).toBe(
      'combobox'
    )
    expect(window.document.querySelector('input[name="oid"]')).not.toBeNull()
  })
})

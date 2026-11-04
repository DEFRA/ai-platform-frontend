// jsdom is loaded by this file rather than as the Vitest environment, so a
// slow first load of it cannot hit the pool's fixed 60 second worker start limit.
import { JSDOM } from 'jsdom'

import { initPeopleSearch } from './people-search.js'

// accessible-autocomplete's browser bundle expects `self`, as a browser has.
vi.hoisted(() => {
  globalThis.self ??= globalThis
})

const URL_PATH = '/teams/flood-risk-team/members/add/people'
const DEBOUNCE = 300
// The library waits before it announces a change, so it is not repeated at every key.
const STATUS_DELAY = 1500
const KEYS = { enter: 13, escape: 27, up: 38, down: 40 }
const OID = '0b8f6f4e-3c0f-4c46-9c58-2d3a8d2f1a11'
const OTHER_OID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const sam = { oid: OID, displayName: 'Sam Carter', email: 'sam@defra.gov.uk' }
const alex = {
  oid: OTHER_OID,
  displayName: 'Alex Doe',
  email: 'alex@defra.gov.uk'
}

const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/teams/flood-risk-team/members/add'
})
const { document } = window

// The add-member page's form as the server renders it, for the parts the
// script touches: the text field with its hint, Search, the select list when
// there is one (with an error if `error` says so), the role and Add.
function page({ value = '', query = '', select = null, error = null } = {}) {
  const options = select
    ? `<option value="">Select a person</option>${select.options
        .map(
          ({ oid, text }) =>
            `<option value="${oid}"${oid === select.chosen ? ' selected' : ''}>${text}</option>`
        )
        .join('')}`
    : ''

  document.body.innerHTML = `
    ${error ? '<div class="govuk-error-summary"><a href="#oid">Select a person</a></div>' : ''}
    <form method="post" data-people-search-url="${URL_PATH}">
      <input type="hidden" name="crumb" value="crumb-1">
      <input type="hidden" name="idempotencyKey" value="key-1">
      <div class="govuk-form-group" id="search-group">
        <label class="govuk-label" for="search">Name or email address</label>
        <div id="search-hint" class="govuk-hint">Enter at least 2 characters</div>
        <input class="govuk-input" id="search" name="search" type="text" value="${value}" aria-describedby="search-hint" data-people-search data-people-query="${query}">
      </div>
      <button type="submit" name="action" value="search" data-people-search-button>Search</button>
      ${
        select
          ? `<div class="govuk-form-group${error ? ' govuk-form-group--error' : ''}" id="oid-group">
              <label class="govuk-label" for="oid">Person</label>
              ${error ? '<p id="oid-error" class="govuk-error-message">Error: Select a person</p>' : ''}
              <select class="govuk-select" id="oid" name="oid">${options}</select>
            </div>`
          : ''
      }
      <button type="submit" name="action" value="add">Add</button>
    </form>`
}

function answer(body, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

const input = () => document.getElementById('search')
const oid = () => document.querySelector('input[name="oid"]')
const options = () => [...document.querySelectorAll('[role="option"]')]
const optionTexts = () => options().map((option) => option.textContent)
const status = () =>
  [...document.querySelectorAll('[role="status"]')]
    .map((element) => element.textContent)
    .join(' ')
    .trim()

describe('#initPeopleSearch', () => {
  let fetchMock

  async function settle(ms = 0) {
    await vi.advanceTimersByTimeAsync(ms)
  }

  async function type(text) {
    input().focus()
    input().value = text
    input().dispatchEvent(new window.Event('input', { bubbles: true }))
    await settle()
  }

  async function typeAndWait(text) {
    await type(text)
    await settle(DEBOUNCE)
  }

  async function press(keyCode, target = input()) {
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', { keyCode, bubbles: true })
    )
    await settle()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn(async () => answer({ items: [sam, alex] }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', window)
    page()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('setting up', () => {
    test('does nothing on a page without the form', () => {
      document.body.innerHTML = '<p>Nothing here</p>'

      expect(initPeopleSearch()).toBeNull()
    })

    test('turns the field into a combobox that keeps its id, name, label, value and hint', () => {
      page({ value: 'sa' })

      const { input: field } = initPeopleSearch()

      expect(field.id).toBe('search')
      expect(field.name).toBe('search')
      expect(field.value).toBe('sa')
      expect(field.getAttribute('role')).toBe('combobox')
      expect(
        document.querySelector('label[for="search"]').textContent
      ).toContain('Name or email address')
      expect(field.getAttribute('aria-describedby')).toMatch(/^search-hint /)
      expect(document.querySelectorAll('#search')).toHaveLength(1)
      expect(document.querySelectorAll('input[name="search"]')).toHaveLength(1)
    })

    test('removes Search, so Enter adds instead of searching, and keeps Add', () => {
      initPeopleSearch()

      expect(document.querySelector('[data-people-search-button]')).toBeNull()
      expect(
        [...document.querySelectorAll('form button')].map((b) => b.value)
      ).toEqual(['add'])
    })

    test('adds one hidden oid, which is empty until a person is chosen', () => {
      initPeopleSearch()

      expect(document.querySelectorAll('input[name="oid"]')).toHaveLength(1)
      expect(oid().type).toBe('hidden')
      expect(oid().value).toBe('')
    })

    test('keeps the person already chosen, from the select list the page came back with', () => {
      page({
        select: {
          options: [
            { oid: OID, text: 'Sam Carter - sam@defra.gov.uk' },
            { oid: OTHER_OID, text: 'Alex Doe - alex@defra.gov.uk' }
          ],
          chosen: OTHER_OID
        },
        value: 'a'
      })

      const { input: field, oid: hidden } = initPeopleSearch()

      expect(document.querySelector('select')).toBeNull()
      expect(document.getElementById('oid-group')).toBeNull()
      expect(document.querySelectorAll('[name="oid"]')).toHaveLength(1)
      expect(hidden.value).toBe(OTHER_OID)
      expect(field.value).toBe('Alex Doe - alex@defra.gov.uk')
    })

    test('keeps the text typed when no person was chosen in the select list', () => {
      page({
        select: {
          options: [{ oid: OID, text: 'Sam Carter - sam@defra.gov.uk' }]
        },
        value: 'sa'
      })

      const { input: field, oid: hidden } = initPeopleSearch()

      expect(hidden.value).toBe('')
      expect(field.value).toBe('sa')
    })

    test('moves the select list’s error to the field and points the summary link at it', () => {
      page({
        select: {
          options: [{ oid: OID, text: 'Sam Carter - sam@defra.gov.uk' }]
        },
        error: true
      })

      const { input: field } = initPeopleSearch()
      const group = document.getElementById('search-group')

      expect(group.classList.contains('govuk-form-group--error')).toBe(true)
      expect(group.querySelector('#oid-error').textContent).toContain(
        'Select a person'
      )
      expect(field.getAttribute('aria-describedby')).toMatch(
        /^search-hint oid-error /
      )
      expect(
        document.querySelector('.govuk-error-summary a').getAttribute('href')
      ).toBe('#search')
    })

    test('keeps the error style on a field that has one', () => {
      input().classList.add('govuk-input--error')

      const { input: field } = initPeopleSearch()

      expect(field.classList.contains('govuk-input--error')).toBe(true)
    })

    test('gives the field the error style when the select list’s error moves to it', () => {
      page({
        select: {
          options: [{ oid: OID, text: 'Sam Carter - sam@defra.gov.uk' }]
        },
        error: true
      })

      const { input: field } = initPeopleSearch()

      expect(field.classList.contains('govuk-input--error')).toBe(true)
    })

    test('does not give a field with no error the error style', () => {
      const { input: field } = initPeopleSearch()

      expect(field.classList.contains('govuk-input--error')).toBe(false)
    })

    test('keeps the hint and the error linked to the field while the person types, and after the field is cleared', async () => {
      page({
        select: {
          options: [{ oid: OID, text: 'Sam Carter - sam@defra.gov.uk' }]
        },
        error: true
      })

      const { input: field } = initPeopleSearch()
      const ids = () => field.getAttribute('aria-describedby').split(' ')

      expect(ids()).toEqual(
        expect.arrayContaining(['search-hint', 'oid-error'])
      )

      await type('sa')
      await settle(STATUS_DELAY)

      expect(ids()).toEqual(
        expect.arrayContaining(['search-hint', 'oid-error'])
      )

      await type('')
      await settle(STATUS_DELAY)

      expect(ids()).toEqual(
        expect.arrayContaining(['search-hint', 'oid-error'])
      )
      expect(ids().filter((id) => id === 'search-hint')).toHaveLength(1)
    })

    test('keeps the hint linked when the library takes its own link away', async () => {
      const { input: field } = initPeopleSearch()

      field.removeAttribute('aria-describedby')
      await settle()

      expect(field.getAttribute('aria-describedby')).toBe('search-hint')
    })
  })

  describe('searching', () => {
    test('waits for typing to pause, then searches once for what was typed, with the CSRF token', async () => {
      initPeopleSearch()

      await type('sa')
      await settle(DEBOUNCE - 1)
      await type('sam')
      await settle(DEBOUNCE - 1)

      expect(fetchMock).not.toHaveBeenCalled()

      await settle(1)

      expect(fetchMock).toHaveBeenCalledTimes(1)

      const [url, options] = fetchMock.mock.calls[0]

      expect(url).toBe(URL_PATH)
      expect(options.method).toBe('POST')
      expect(options.credentials).toBe('same-origin')
      expect(options.headers['x-csrf-token']).toBe('crumb-1')
      expect(options.headers['content-type']).toBe('application/json')
      expect(JSON.parse(options.body)).toEqual({ search: 'sam' })
    })

    test.each(['', 's', '  s ', '   '])(
      'does not search for "%s"',
      async (text) => {
        initPeopleSearch()

        await typeAndWait(text)
        await settle(DEBOUNCE)

        expect(fetchMock).not.toHaveBeenCalled()
      }
    )

    test('lists the people as "Name - email", and announces how many', async () => {
      initPeopleSearch()

      await typeAndWait('sa')

      expect(optionTexts()).toEqual([
        'Sam Carter - sam@defra.gov.uk',
        'Alex Doe - alex@defra.gov.uk'
      ])
      expect(input().getAttribute('aria-expanded')).toBe('true')

      await settle(STATUS_DELAY)

      expect(status()).toContain('2 results are available')
    })

    test('shows a name as text, never as markup', async () => {
      fetchMock.mockResolvedValue(
        answer({
          items: [
            {
              oid: OID,
              displayName: '<img src=x onerror=alert(1)>',
              email: 'a&b@defra.gov.uk'
            }
          ]
        })
      )
      initPeopleSearch()

      await typeAndWait('sa')

      expect(document.querySelector('[role="option"] img')).toBeNull()
      expect(optionTexts()).toEqual([
        '<img src=x onerror=alert(1)> - a&b@defra.gov.uk'
      ])
    })

    test('drops a search still on its way when the text changes again', async () => {
      let signal
      fetchMock.mockImplementationOnce((_url, options) => {
        signal = options.signal

        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () =>
            reject(new window.DOMException('Aborted', 'AbortError'))
          )
        )
      })
      initPeopleSearch()

      await typeAndWait('sa')
      await typeAndWait('sam')

      expect(signal.aborted).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(optionTexts()).toEqual([
        'Sam Carter - sam@defra.gov.uk',
        'Alex Doe - alex@defra.gov.uk'
      ])
    })

    test('shows nothing from an answer that arrives after the person typed again', async () => {
      let resolveFirst
      fetchMock.mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve))
      )
      initPeopleSearch()

      await typeAndWait('sa')
      await type('s')
      resolveFirst(answer({ items: [sam] }))
      await settle()

      expect(optionTexts()).not.toContain('Sam Carter - sam@defra.gov.uk')
    })

    test('says it is searching until the answer comes, and not that no one was found', async () => {
      fetchMock.mockImplementation(() => new Promise(() => {}))
      initPeopleSearch()

      await typeAndWait('sam')

      expect(optionTexts()).toEqual(['Searching'])
    })

    test('says no one was found, and to try their full email address', async () => {
      fetchMock.mockResolvedValue(answer({ items: [] }))
      initPeopleSearch()

      await typeAndWait('zzz')

      expect(optionTexts()).toEqual([
        'No people found. Try their full email address'
      ])

      await settle(STATUS_DELAY)

      expect(status()).toContain('No people found')
    })

    test('says why when the directory is not available, in the words of the answer', async () => {
      fetchMock.mockResolvedValue(
        answer({ message: 'We could not search the directory.' }, 503)
      )
      initPeopleSearch()

      await typeAndWait('sam')

      expect(optionTexts()).toEqual(['We could not search the directory.'])
    })

    test.each([
      [
        'an answer with no message',
        () => new Response('<html>', { status: 403 })
      ],
      ['a request that fails', () => Promise.reject(new TypeError('offline'))]
    ])(
      'says the directory could not be searched for %s',
      async (_name, fail) => {
        fetchMock.mockImplementation(fail)
        initPeopleSearch()

        await typeAndWait('sam')

        expect(optionTexts()).toEqual([
          'We could not search the directory. Try again in a few minutes'
        ])
      }
    )

    test('sends a signed-out person to sign in, and comes back to this page', async () => {
      const assign = vi.fn()
      fetchMock.mockResolvedValue(answer({ message: 'Sign in' }, 401))
      initPeopleSearch()

      await type('sam')
      // A page's location cannot be replaced in jsdom, so the window it is
      // read from is.
      vi.stubGlobal('window', {
        location: { pathname: '/teams/flood-risk-team/members/add', assign }
      })
      await settle(DEBOUNCE)

      expect(assign).toHaveBeenCalledWith(
        '/sign-in?returnTo=%2Fteams%2Fflood-risk-team%2Fmembers%2Fadd'
      )
    })
  })

  describe('choosing', () => {
    test('Down moves through the list, Enter chooses, and the person goes in the hidden oid', async () => {
      initPeopleSearch()
      await typeAndWait('sa')

      await press(KEYS.down)
      await press(KEYS.down)
      await press(KEYS.up)

      expect(document.activeElement.textContent).toBe(
        'Sam Carter - sam@defra.gov.uk'
      )

      await press(KEYS.enter, document.activeElement)

      expect(input().value).toBe('Sam Carter - sam@defra.gov.uk')
      expect(oid().value).toBe(OID)
      expect(input().getAttribute('aria-expanded')).toBe('false')
    })

    test('chooses the second person with Down twice', async () => {
      initPeopleSearch()
      await typeAndWait('sa')

      await press(KEYS.down)
      await press(KEYS.down)
      await press(KEYS.enter, document.activeElement)

      expect(oid().value).toBe(OTHER_OID)
      expect(input().value).toBe('Alex Doe - alex@defra.gov.uk')
    })

    test('chooses with a click', async () => {
      initPeopleSearch()
      await typeAndWait('sa')

      options()[1].dispatchEvent(new window.Event('click', { bubbles: true }))
      await settle()

      expect(oid().value).toBe(OTHER_OID)
    })

    test('Escape closes the list and chooses no one', async () => {
      initPeopleSearch()
      await typeAndWait('sa')

      await press(KEYS.escape)

      expect(input().getAttribute('aria-expanded')).toBe('false')
      expect(oid().value).toBe('')
    })

    test('does not choose anyone when the field is left', async () => {
      initPeopleSearch()
      await typeAndWait('sa')

      input().dispatchEvent(new window.Event('blur', { bubbles: true }))
      await settle(200)

      expect(oid().value).toBe('')
    })

    test('editing the text after choosing takes the choice back', async () => {
      initPeopleSearch()
      await typeAndWait('sa')
      await press(KEYS.down)
      await press(KEYS.enter, document.activeElement)

      expect(oid().value).toBe(OID)

      await type('Sam Carter - sam@defra.gov.uk x')

      expect(oid().value).toBe('')
    })
  })

  // The field shows "Name - email" once a person is chosen, which is not
  // something the directory can be searched for, so the form also sends what
  // was typed to find them.
  describe('what the form sends', () => {
    const query = () => document.querySelector('input[name="query"]')
    const sent = () =>
      Object.fromEntries(
        new window.FormData(document.querySelector('form')).entries()
      )

    test('adds one hidden query, empty until something is typed', () => {
      initPeopleSearch()

      expect(document.querySelectorAll('input[name="query"]')).toHaveLength(1)
      expect(query().type).toBe('hidden')
      expect(query().value).toBe('')
    })

    test('sends the text typed as the query, the label as the search and the person as the oid', async () => {
      initPeopleSearch()
      await typeAndWait('sa')
      await press(KEYS.down)
      await press(KEYS.enter, document.activeElement)

      expect(sent()).toMatchObject({
        search: 'Sam Carter - sam@defra.gov.uk',
        query: 'sa',
        oid: OID
      })
    })

    test('keeps the query when the label is long, and when the person is chosen with a click', async () => {
      const long = { ...sam, displayName: 'Sam '.repeat(40).trim() }

      fetchMock.mockResolvedValue(answer({ items: [long] }))
      initPeopleSearch()
      await typeAndWait('sam')
      options()[0].dispatchEvent(new window.Event('click', { bubbles: true }))
      await settle()

      expect(sent().search.length).toBeGreaterThan(100)
      expect(sent().query).toBe('sam')
      expect(sent().oid).toBe(OID)
    })

    test('sends what the page sent back as the query, until the text is edited', async () => {
      page({
        value: 'Sam Carter - sam@defra.gov.uk',
        query: 'sam',
        select: {
          options: [{ oid: OID, text: 'Sam Carter - sam@defra.gov.uk' }],
          chosen: OID
        }
      })
      initPeopleSearch()

      expect(sent()).toMatchObject({
        search: 'Sam Carter - sam@defra.gov.uk',
        query: 'sam',
        oid: OID
      })

      await type('Sam Carter - sam@defra.gov.uk x')

      expect(sent().query).toBe('Sam Carter - sam@defra.gov.uk x')
      expect(sent().oid).toBe('')
    })
  })
})

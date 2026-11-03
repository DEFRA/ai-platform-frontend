import accessibleAutocomplete from 'accessible-autocomplete'

// Progressive enhancement for the add-member page. Without script, the page
// searches when "Search" is pressed and lists the matches in a select list.
// With script, the text field becomes a combobox that finds people as the
// admin types, and the person chosen goes in a hidden `oid`. Choosing is
// deliberate: nothing is chosen on blur, and editing the text unchooses.

const MIN_LENGTH = 2
const DEBOUNCE_MS = 300
const FORM_SELECTOR = 'form[data-people-search-url]'
const INPUT_SELECTOR = 'input[data-people-search]'
const SEARCH_BUTTON_SELECTOR = '[data-people-search-button]'
const UNAVAILABLE =
  'We could not search the directory. Try again in a few minutes'
const NO_PEOPLE = 'No people found. Try their full email address'
const SEARCHING = 'Searching'
const UNAUTHORIZED = 401

function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]
  )
}

// What an option, and the field once it is chosen, say: "Name - email". The
// default value of a field that has one already is the text itself.
function label(person) {
  if (typeof person === 'string') {
    return person
  }

  return person ? `${person.displayName} - ${person.email}` : ''
}

// Names come from the directory, and the library puts a suggestion in as
// HTML, so it is escaped here.
function suggestion(person) {
  return escapeHtml(label(person))
}

function signInAgain() {
  window.location.assign(
    `/sign-in?returnTo=${encodeURIComponent(window.location.pathname)}`
  )
}

// What the answer says about why there are no people, or null for people.
async function problemWith(response) {
  const body = await response.json().catch(() => null)

  return body?.message ?? UNAVAILABLE
}

/**
 * The search the combobox runs: it waits for typing to pause, drops the one
 * before when a new one starts, and says why when there is nobody to show.
 * @param {{url: string, crumb: string}} endpoint
 * @returns {{source: Function, cancel: () => void, message: () => string}}
 */
function createSearch({ url, crumb }) {
  let timer = null
  let controller = null
  let message = NO_PEOPLE

  function cancel() {
    clearTimeout(timer)
    controller?.abort()
    controller = null
  }

  async function lookup(search, populate) {
    controller = new AbortController()
    const { signal } = controller

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': crumb },
        credentials: 'same-origin',
        body: JSON.stringify({ search }),
        signal
      })

      if (response.status === UNAUTHORIZED) {
        signInAgain()
        return
      }

      const items = response.ok ? (await response.json()).items : []

      message = response.ok ? NO_PEOPLE : await problemWith(response)

      if (!signal.aborted) {
        populate(items)
      }
    } catch {
      if (!signal.aborted) {
        message = UNAVAILABLE
        populate([])
      }
    }
  }

  function source(query, populate) {
    cancel()

    const search = query.trim()

    if (search.length < MIN_LENGTH) {
      populate([])
      return
    }

    // Until the answer comes, the list is not "no people": it is not known yet.
    message = SEARCHING
    timer = setTimeout(() => lookup(search, populate), DEBOUNCE_MS)
  }

  return { source, cancel, message: () => message }
}

function hiddenOid(form, select) {
  const hidden = form.ownerDocument.createElement('input')

  hidden.type = 'hidden'
  hidden.name = 'oid'
  hidden.value = select?.value ?? ''

  return hidden
}

// The select list is for people without script. Its error, if it has one,
// moves to the text field, which is where the person is looked for now.
// Returns the id of the error it moved, if any.
function takeOverFromSelect(select, searchGroup) {
  const group = select.closest('.govuk-form-group')
  const error = group?.querySelector('.govuk-error-message')

  if (error) {
    searchGroup.classList.add('govuk-form-group--error')
    searchGroup.querySelector('.govuk-label').after(error)
  }

  group?.remove()
  select.ownerDocument
    .querySelectorAll('a[href="#oid"]')
    .forEach((link) => link.setAttribute('href', '#search'))

  return error?.id
}

// The hint and any error describe the field for as long as the page is open.
// The library sets `aria-describedby` itself, to its own instructions, and
// replaces it at every key, so the ids are put back ahead of its own whenever
// they are missing.
function keepDescribedBy(input, ids) {
  function put() {
    const others = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((id) => id && !ids.includes(id))
    const wanted = [...ids, ...others].join(' ')

    if (input.getAttribute('aria-describedby') !== wanted) {
      input.setAttribute('aria-describedby', wanted)
    }
  }

  new input.ownerDocument.defaultView.MutationObserver(put).observe(input, {
    attributes: true,
    attributeFilter: ['aria-describedby']
  })
  put()
}

/**
 * Turns the add-member page's name field into a combobox. It does nothing on
 * a page without the form.
 * @param {ParentNode} [root]
 * @returns {{input: HTMLInputElement, oid: HTMLInputElement} | null} The field and the hidden `oid`, or null when there is nothing to enhance.
 */
export function initPeopleSearch(root = document) {
  const form = root.querySelector(FORM_SELECTOR)
  const original = form?.querySelector(INPUT_SELECTOR)

  if (!form || !original) {
    return null
  }

  const select = form.querySelector('select[name="oid"]')
  const chosen = select?.value ? select.selectedOptions[0].textContent : ''
  const oid = hiddenOid(form, select)
  const searchGroup = original.closest('.govuk-form-group')
  const search = createSearch({
    url: form.dataset.peopleSearchUrl,
    crumb: form.querySelector('input[name="crumb"]').value
  })
  const container = original.ownerDocument.createElement('div')
  // The hint, and any error, that describe the field (the select list's error
  // is the field's once it has moved).
  const movedError = select ? takeOverFromSelect(select, searchGroup) : null
  const describedBy = [
    ...(original.getAttribute('aria-describedby') ?? '').split(' '),
    movedError
  ].filter(Boolean)

  container.className = 'app-people-search'
  original.after(container)
  form.append(oid)
  form.querySelector(SEARCH_BUTTON_SELECTOR)?.remove()

  accessibleAutocomplete({
    element: container,
    id: original.id,
    name: original.name,
    defaultValue: chosen || original.value,
    minLength: MIN_LENGTH,
    displayMenu: 'overlay',
    confirmOnBlur: false,
    inputClasses:
      movedError || original.classList.contains('govuk-input--error')
        ? 'govuk-input--error'
        : null,
    source: search.source,
    templates: { inputValue: label, suggestion },
    tNoResults: search.message,
    tStatusNoResults: search.message,
    onConfirm(person) {
      // A text (the person already chosen, shown again) has no oid to change.
      if (person?.oid) {
        oid.value = person.oid
      }
    }
  })
  original.remove()

  const input = container.querySelector('input')

  keepDescribedBy(input, describedBy)
  input.addEventListener('input', () => {
    oid.value = ''

    // The library does not ask for people for text this short, so it is not
    // told to drop a search that is still on its way.
    if (input.value.trim().length < MIN_LENGTH) {
      search.cancel()
    }
  })

  return { input, oid }
}

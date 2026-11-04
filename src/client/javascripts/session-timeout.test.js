// jsdom is loaded by this file rather than as the Vitest environment, so a
// slow first load of it cannot hit the pool's fixed 60 second worker start limit.
import { JSDOM } from 'jsdom'

import { initSessionTimeout } from './session-timeout.js'

const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/'
})
const { document } = window

const IDLE = 30 * 60
const MAX_AGE = 8 * 60 * 60
const WARNING = 120

function dialogHtml({
  idleSeconds = IDLE,
  maxAgeSeconds = MAX_AGE,
  warningSeconds = WARNING
} = {}) {
  return `
    <button id="outside" type="button">Outside</button>
    <dialog data-module="app-session-timeout"
      data-status-url="/session/status"
      data-signed-out-url="/signed-out"
      data-idle-seconds="${idleSeconds}"
      data-max-age-seconds="${maxAgeSeconds}"
      data-warning-seconds="${warningSeconds}"
      aria-labelledby="heading">
      <h2 id="heading">You are about to be signed out</h2>
      <p>We will sign you out in <span data-timeout-remaining></span>.</p>
      <p data-timeout-overall-note hidden>This is the longest a session can last.</p>
      <p class="govuk-visually-hidden" role="status" data-timeout-announcement></p>
      <form method="post" action="/session/extend" data-timeout-extend>
        <input type="hidden" name="crumb" value="crumb-1">
        <button type="submit" id="stay">Stay signed in</button>
      </form>
      <form method="post" action="/sign-out">
        <button type="submit" id="out">Sign out</button>
      </form>
    </dialog>`
}

function times(idleSeconds, maxAgeSeconds = MAX_AGE) {
  return new Response(
    JSON.stringify({ idleSeconds, maxAgeSeconds, warningSeconds: WARNING }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

// What fetch gives for `redirect: 'manual'` when the server redirects.
function redirectNotFollowed() {
  const response = new Response(null)

  Object.defineProperty(response, 'type', { value: 'opaqueredirect' })
  Object.defineProperty(response, 'status', { value: 0 })
  Object.defineProperty(response, 'ok', { value: false })

  return response
}

// A queued answer can be asked for more than once; a body can be read once, so
// every caller gets its own copy (a redirect has no body to copy).
function replay(response) {
  return response?.type === 'opaqueredirect' ? response : response.clone()
}

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden
  })
  document.dispatchEvent(new window.Event('visibilitychange'))
}

const dialog = () => document.querySelector('dialog')
const remaining = () =>
  document.querySelector('[data-timeout-remaining]').textContent
const announcement = () =>
  document.querySelector('[data-timeout-announcement]').textContent
const extendForm = () => document.querySelector('[data-timeout-extend]')

describe('#initSessionTimeout', () => {
  let fetchMock
  let assign
  let showModal
  let close
  let stop

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    assign = vi.fn()
    // jsdom has no modal dialog: stand in for what the browser does.
    showModal = vi.fn(() => dialog().setAttribute('open', ''))
    close = vi.fn(() => dialog().removeAttribute('open'))
    vi.stubGlobal('fetch', (...args) =>
      Promise.resolve(fetchMock(...args)).then(replay)
    )
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', { location: { assign } })
    setHidden(false)
    document.body.innerHTML = dialogHtml()
    dialog().showModal = showModal
    dialog().close = close
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function start() {
    stop = initSessionTimeout()
    return stop
  }

  const tick = (seconds) => vi.advanceTimersByTimeAsync(seconds * 1000)
  const warnAt = IDLE - WARNING

  test('does nothing on a page with no timeout dialog', async () => {
    document.body.innerHTML = '<p>Nothing here</p>'

    expect(start()).toBeNull()
    await tick(IDLE * 2)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('shows nothing before the warning time and asks nothing', async () => {
    start()

    await tick(warnAt - 1)

    expect(showModal).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('checks how long is left when the warning time comes, and warns when it is true', async () => {
    fetchMock.mockResolvedValue(times(WARNING))
    start()

    await tick(warnAt)

    expect(fetchMock).toHaveBeenCalledWith(
      '/session/status',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'manual'
      })
    )
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(remaining()).toBe('2 minutes')
  })

  test('does not warn when another tab has kept the session alive, and warns later', async () => {
    fetchMock.mockResolvedValueOnce(times(IDLE))
    start()

    await tick(warnAt)
    expect(showModal).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(times(WARNING))
    await tick(IDLE - WARNING)

    expect(showModal).toHaveBeenCalledTimes(1)
  })

  test('warns from its own clock when the check cannot be made', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    start()

    await tick(warnAt)

    expect(showModal).toHaveBeenCalledTimes(1)
  })

  test('warns from its own clock when the check gets a server error', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 503 }))
    start()

    await tick(warnAt)

    expect(showModal).toHaveBeenCalledTimes(1)
  })

  test('warns from its own clock when the answer is not the times', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))
    start()

    await tick(warnAt)

    expect(showModal).toHaveBeenCalledTimes(1)
  })

  test('counts down each second and announces every 30 seconds', async () => {
    fetchMock.mockResolvedValue(times(WARNING))
    start()
    await tick(warnAt)

    expect(announcement()).toBe('You will be signed out in 2 minutes.')

    await tick(1)
    expect(remaining()).toBe('1 minute and 59 seconds')
    expect(announcement()).toBe('You will be signed out in 2 minutes.')

    await tick(29)
    expect(remaining()).toBe('1 minute and 30 seconds')
    expect(announcement()).toBe(
      'You will be signed out in 1 minute and 30 seconds.'
    )

    await tick(30)
    expect(remaining()).toBe('1 minute')

    await tick(15)
    expect(remaining()).toBe('45 seconds')
  })

  test('says one second in the singular', async () => {
    fetchMock.mockResolvedValue(times(WARNING))
    start()
    await tick(warnAt + WARNING - 1)

    expect(remaining()).toBe('1 second')
  })

  describe('staying signed in', () => {
    beforeEach(async () => {
      fetchMock.mockResolvedValueOnce(times(WARNING))
      start()
      await tick(warnAt)
      fetchMock.mockResolvedValue(times(IDLE))
    })

    test('posts to the extend address with the CSRF token', async () => {
      extendForm().dispatchEvent(
        new window.Event('submit', { cancelable: true })
      )
      await tick(0)

      const [url, init] = fetchMock.mock.calls.at(-1)
      expect(url).toBe('http://localhost/session/extend')
      expect(init.method).toBe('POST')
      expect(init.redirect).toBe('manual')
      expect(init.body.toString()).toBe('crumb=crumb-1')
    })

    test('closes the warning, and warns again for the new time', async () => {
      extendForm().dispatchEvent(
        new window.Event('submit', { cancelable: true })
      )
      await tick(0)

      expect(close).toHaveBeenCalledTimes(1)

      await tick(IDLE - WARNING - 1)
      expect(showModal).toHaveBeenCalledTimes(1)

      fetchMock.mockResolvedValue(times(WARNING))
      await tick(1)
      expect(showModal).toHaveBeenCalledTimes(2)
    })

    test('the Escape key stays signed in too', async () => {
      const cancel = new window.Event('cancel', { cancelable: true })

      dialog().dispatchEvent(cancel)
      await tick(0)

      expect(cancel.defaultPrevented).toBe(true)
      expect(fetchMock.mock.calls.at(-1)[0]).toBe(
        'http://localhost/session/extend'
      )
      expect(close).toHaveBeenCalled()
    })

    test('keeps the warning open when staying signed in could not be asked', async () => {
      fetchMock.mockRejectedValue(new TypeError('offline'))

      extendForm().dispatchEvent(
        new window.Event('submit', { cancelable: true })
      )
      await tick(0)

      expect(close).not.toHaveBeenCalled()
      expect(dialog().hasAttribute('open')).toBe(true)
    })

    test('goes to the signed-out page when the server says the session has ended', async () => {
      fetchMock.mockResolvedValue(redirectNotFollowed())

      extendForm().dispatchEvent(
        new window.Event('submit', { cancelable: true })
      )
      await tick(0)

      expect(assign).toHaveBeenCalledWith('/signed-out?reason=idle')
    })

    test('goes to the signed-out page when the server refuses it', async () => {
      fetchMock.mockResolvedValue(new Response('no', { status: 403 }))

      extendForm().dispatchEvent(
        new window.Event('submit', { cancelable: true })
      )
      await tick(0)

      expect(assign).toHaveBeenCalledWith('/signed-out?reason=idle')
    })

    describe('when staying signed in fails in a way nobody planned for', () => {
      let unhandled

      beforeEach(() => {
        unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        // The form has lost its CSRF token field, so asking cannot even start.
        extendForm().querySelector('[name="crumb"]').remove()
      })

      afterEach(() => {
        process.off('unhandledRejection', unhandled)
      })

      // The rejection is reported by Node once the real event loop turns.
      async function letNodeReport() {
        vi.useRealTimers()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      test('leaves the warning open and lets no rejection escape when the form is submitted', async () => {
        extendForm().dispatchEvent(
          new window.Event('submit', { cancelable: true })
        )
        await letNodeReport()

        expect(unhandled).not.toHaveBeenCalled()
        expect(close).not.toHaveBeenCalled()
        expect(assign).not.toHaveBeenCalled()
        expect(dialog().hasAttribute('open')).toBe(true)
      })

      test('leaves the warning open and lets no rejection escape when Escape is pressed', async () => {
        dialog().dispatchEvent(new window.Event('cancel', { cancelable: true }))
        await letNodeReport()

        expect(unhandled).not.toHaveBeenCalled()
        expect(close).not.toHaveBeenCalled()
        expect(assign).not.toHaveBeenCalled()
        expect(dialog().hasAttribute('open')).toBe(true)
      })
    })
  })

  describe('when the time runs out', () => {
    beforeEach(async () => {
      fetchMock.mockResolvedValueOnce(times(WARNING))
      start()
      await tick(warnAt)
    })

    test('goes to the signed-out page, naming the idle limit, once the server confirms', async () => {
      fetchMock.mockResolvedValue(redirectNotFollowed())

      await tick(WARNING)

      expect(assign).toHaveBeenCalledTimes(1)
      expect(assign).toHaveBeenCalledWith('/signed-out?reason=idle')
    })

    test('goes to the signed-out page when the server cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('offline'))

      await tick(WARNING)

      expect(assign).toHaveBeenCalledWith('/signed-out?reason=idle')
    })

    test('stays when another tab kept the session alive, and hides the warning', async () => {
      fetchMock.mockResolvedValue(times(IDLE))

      await tick(WARNING)

      expect(assign).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalled()
    })

    test('stops counting once it has gone', async () => {
      fetchMock.mockResolvedValue(redirectNotFollowed())
      await tick(WARNING)
      const calls = fetchMock.mock.calls.length

      await tick(60)

      expect(fetchMock.mock.calls.length).toBe(calls)
      expect(assign).toHaveBeenCalledTimes(1)
    })
  })

  describe('the 8 hour limit', () => {
    beforeEach(async () => {
      document.body.innerHTML = dialogHtml({
        idleSeconds: IDLE,
        maxAgeSeconds: 300
      })
      dialog().showModal = showModal
      dialog().close = close
      fetchMock.mockResolvedValueOnce(times(IDLE, WARNING))
      start()
      await tick(300 - WARNING)
    })

    test('warns, with no way to stay signed in', () => {
      expect(showModal).toHaveBeenCalledTimes(1)
      expect(extendForm().hidden).toBe(true)
      expect(document.querySelector('[data-timeout-overall-note]').hidden).toBe(
        false
      )
    })

    test('names the overall limit on the signed-out page', async () => {
      fetchMock.mockResolvedValue(redirectNotFollowed())

      await tick(WARNING)

      expect(assign).toHaveBeenCalledWith('/signed-out?reason=expired')
    })

    test('the Escape key does not close a warning that cannot be dismissed by staying', async () => {
      const cancel = new window.Event('cancel', { cancelable: true })

      dialog().dispatchEvent(cancel)
      await tick(0)

      expect(cancel.defaultPrevented).toBe(true)
      expect(close).not.toHaveBeenCalled()
    })
  })

  describe('a page that was hidden', () => {
    test('shows the warning once, not again, when it is shown with the warning already open', async () => {
      fetchMock.mockResolvedValueOnce(times(WARNING))
      start()
      await tick(warnAt)
      fetchMock.mockResolvedValue(times(WARNING - 30))

      setHidden(false)
      await tick(0)

      expect(showModal).toHaveBeenCalledTimes(1)
      expect(remaining()).toBe('1 minute and 30 seconds')
    })

    test('leaves when it is shown after the time is up by its own clock and the server agrees', async () => {
      fetchMock.mockResolvedValue(times(0))
      start()

      setHidden(false)
      await tick(0)

      expect(assign).toHaveBeenCalledWith('/signed-out?reason=idle')
    })

    test('goes to the signed-out page when the server says so at the warning time', async () => {
      fetchMock.mockResolvedValue(redirectNotFollowed())
      start()

      await tick(warnAt)

      expect(assign).toHaveBeenCalledWith('/signed-out?reason=idle')
      expect(showModal).not.toHaveBeenCalled()
    })

    test('checks how long is left when it is shown again', async () => {
      fetchMock.mockResolvedValue(times(IDLE))
      start()
      setHidden(true)
      await tick(0)
      expect(fetchMock).not.toHaveBeenCalled()

      setHidden(false)
      await tick(0)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test('goes to the signed-out page if the session ended while it was hidden', async () => {
      fetchMock.mockResolvedValue(redirectNotFollowed())
      start()

      setHidden(false)
      await tick(0)

      expect(assign).toHaveBeenCalledWith('/signed-out?reason=idle')
    })
  })

  describe('stopping', () => {
    test('clears its timers and stops listening', async () => {
      start()()
      stop = undefined

      setHidden(false)
      await tick(IDLE * 2)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(showModal).not.toHaveBeenCalled()
    })
  })
})

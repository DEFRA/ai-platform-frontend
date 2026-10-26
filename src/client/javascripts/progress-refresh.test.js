// jsdom is loaded by this file rather than as the Vitest environment, so a
// slow first load of it cannot hit the pool's fixed 60 second worker start limit.
import { JSDOM } from 'jsdom'

import { initProgressRefresh } from './progress-refresh.js'

const STATUS_URL = '/teams/flood-risk-team?fragment=status'
const INTERVAL = 5000

const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/'
})
const { document } = window

function status(inProgress, body = 'Setting up') {
  return `<div data-in-progress="${inProgress}"><p>${body}</p><a class="govuk-link" href="/teams/flood-risk-team" id="check">Check progress</a></div>`
}

function page(inner = status(true)) {
  document.body.innerHTML = `
    <button id="outside" type="button">Outside</button>
    <div id="region" aria-live="polite" data-progress-refresh="${STATUS_URL}">${inner}</div>`
}

function answer(html, { status: code = 200, etag = '"v1"', redirected } = {}) {
  const response = new Response(code === 304 ? null : html, {
    status: code,
    headers: etag ? { ETag: etag } : {}
  })

  if (redirected) {
    Object.defineProperty(response, 'redirected', { value: true })
  }

  return response
}

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden
  })
  document.dispatchEvent(new window.Event('visibilitychange'))
}

const region = () => document.getElementById('region')
const text = () => region().textContent.replace(/\s+/g, ' ').trim()

describe('#initProgressRefresh', () => {
  let fetchMock
  let stop

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', window)
    setHidden(false)
    page()
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function start() {
    stop = initProgressRefresh()
    return stop
  }

  const tick = (ms = INTERVAL) => vi.advanceTimersByTimeAsync(ms)

  describe('starting', () => {
    test('does nothing on a page with no status to follow', async () => {
      document.body.innerHTML = '<p>Nothing here</p>'

      expect(start()).toBeNull()
      await tick(60000)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    test('does nothing when nothing is in progress', async () => {
      page(status(false))

      expect(start()).toBeNull()
      await tick(60000)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    test('does nothing when the region holds no status', async () => {
      page('<p>Could not list</p>')

      expect(start()).toBeNull()
      await tick(60000)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    test('asks every 5 seconds, not before, for the address the page gave', async () => {
      fetchMock.mockResolvedValue(answer(status(true), { status: 304 }))
      start()

      await tick(INTERVAL - 1)
      expect(fetchMock).not.toHaveBeenCalled()

      await tick(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(STATUS_URL)
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        credentials: 'same-origin',
        cache: 'no-store'
      })

      await tick()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    test('waits to start while the page is hidden, and starts when it is shown', async () => {
      setHidden(true)
      start()

      await tick(60000)
      expect(fetchMock).not.toHaveBeenCalled()

      fetchMock.mockResolvedValue(answer(status(true), { status: 304 }))
      setHidden(false)
      await tick(0)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('a change', () => {
    test('is swapped into the same region, which stays a polite live region', async () => {
      const original = region()
      fetchMock.mockResolvedValue(answer(status(true, 'Deploying')))
      start()

      await tick()

      expect(region()).toBe(original)
      expect(region().getAttribute('aria-live')).toBe('polite')
      expect(text()).toContain('Deploying')
      expect(text()).not.toContain('Setting up')
    })

    test('is asked for again with the ETag of the last one, and a 304 changes nothing', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(status(true, 'Deploying')))
        .mockResolvedValue(answer('', { status: 304, etag: null }))
      start()

      await tick()
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
        'If-None-Match'
      )
      const link = document.getElementById('check')

      await tick()

      expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBe('"v1"')
      expect(document.getElementById('check')).toBe(link)
      expect(text()).toContain('Deploying')
    })

    test('keeps focus on the same link when the content is swapped', async () => {
      fetchMock.mockResolvedValue(answer(status(true, 'Deploying')))
      start()
      document.getElementById('check').focus()
      const before = document.activeElement

      await tick()

      expect(document.activeElement).not.toBe(before)
      expect(document.activeElement.id).toBe('check')
    })

    test('keeps focus on a link with no id by its address', async () => {
      page(
        '<div data-in-progress="true"><a href="/connect/team/request/a/b">See progress</a></div>'
      )
      fetchMock.mockResolvedValue(
        answer(
          '<div data-in-progress="true"><p>More</p><a href="/connect/team/request/a/b">See progress</a></div>'
        )
      )
      start()
      region().querySelector('a').focus()

      await tick()

      expect(document.activeElement.getAttribute('href')).toBe(
        '/connect/team/request/a/b'
      )
      expect(region().contains(document.activeElement)).toBe(true)
    })

    test('does not take focus from outside the region', async () => {
      fetchMock.mockResolvedValue(answer(status(true, 'Deploying')))
      start()
      document.getElementById('outside').focus()

      await tick()

      expect(document.activeElement.id).toBe('outside')
    })

    test('does not move focus when nothing in the region had it', async () => {
      fetchMock.mockResolvedValue(answer(status(true, 'Deploying')))
      start()

      await tick()

      expect(document.activeElement).toBe(document.body)
    })

    test('leaves focus alone when the focused link has gone from the new content', async () => {
      fetchMock.mockResolvedValue(
        answer('<div data-in-progress="true"><p>Gone</p></div>')
      )
      start()
      document.getElementById('check').focus()

      await tick()

      expect(text()).toContain('Gone')
      expect(region().contains(document.activeElement)).toBe(false)
    })

    test('does not guess at focus on an element with neither an id nor an address', async () => {
      page(
        '<div data-in-progress="true"><button type="button">Go</button></div>'
      )
      fetchMock.mockResolvedValue(
        answer(
          '<div data-in-progress="true"><button type="button">Stop</button><button type="button">Go</button></div>'
        )
      )
      start()
      region().querySelector('button').focus()

      await tick()

      expect(region().contains(document.activeElement)).toBe(false)
    })
  })

  describe('stopping', () => {
    test('stops once the status says nothing is in progress, after showing it', async () => {
      fetchMock.mockResolvedValue(answer(status(false, 'All done')))
      start()

      await tick()
      expect(text()).toContain('All done')

      await tick(60000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test('stops when asked to', async () => {
      fetchMock.mockResolvedValue(answer('', { status: 304 }))
      start()()
      stop = undefined

      await tick(60000)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    test('stops asking while the page is hidden, and asks at once when it is shown again', async () => {
      fetchMock.mockResolvedValue(answer('', { status: 304 }))
      start()
      await tick()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      setHidden(true)
      await tick(60000)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      setHidden(false)
      await tick(0)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await tick()
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    test('does not ask again while a request is still waiting, even if the page is shown again', async () => {
      let finish
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      start()
      await tick()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      setHidden(true)
      setHidden(false)
      await tick(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      fetchMock.mockResolvedValue(answer('', { status: 304 }))
      finish(answer('', { status: 304 }))
      await tick()

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    test('does not ask again after hiding while a request was waiting', async () => {
      let finish
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      start()
      await tick()
      setHidden(true)

      finish(answer('', { status: 304 }))
      await tick(60000)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test.each([
      [
        'signed out (a redirect)',
        () => answer(status(true), { redirected: true })
      ],
      ['not found', () => answer('', { status: 404 })],
      ['refused', () => answer('', { status: 403 })],
      ['not a status at all', () => answer('<p>Some other page</p>')]
    ])('stops for good when the answer is %s', async (_name, response) => {
      fetchMock.mockResolvedValue(response())
      start()

      await tick()
      expect(text()).toContain('Setting up')

      await tick(60000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('a fault', () => {
    test.each([
      ['a network error', () => Promise.reject(new TypeError('Failed'))],
      ['a server error', () => Promise.resolve(answer('', { status: 503 }))]
    ])(
      'after %s backs off 10, 20, 40 and then 60 seconds, and keeps what the page has',
      async (_name, fault) => {
        fetchMock.mockImplementation(fault)
        start()

        await tick()
        expect(fetchMock).toHaveBeenCalledTimes(1)

        await tick(2 * INTERVAL - 1)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await tick(1)
        expect(fetchMock).toHaveBeenCalledTimes(2)

        await tick(4 * INTERVAL)
        expect(fetchMock).toHaveBeenCalledTimes(3)

        await tick(8 * INTERVAL)
        expect(fetchMock).toHaveBeenCalledTimes(4)

        await tick(12 * INTERVAL - 1)
        expect(fetchMock).toHaveBeenCalledTimes(4)
        await tick(1)
        expect(fetchMock).toHaveBeenCalledTimes(5)

        await tick(12 * INTERVAL)
        expect(fetchMock).toHaveBeenCalledTimes(6)
        expect(text()).toContain('Setting up')
      }
    )

    test('goes back to every 5 seconds once an answer comes', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed'))
        .mockResolvedValue(answer('', { status: 304 }))
      start()

      await tick()
      await tick(2 * INTERVAL)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await tick()
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    test('gives up on a request that hangs after 10 seconds, and backs off', async () => {
      fetchMock.mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
      start()

      await tick()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await tick(10000 + 2 * INTERVAL)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})

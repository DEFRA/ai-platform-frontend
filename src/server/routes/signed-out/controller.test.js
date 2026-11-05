import * as cheerio from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  signInViaOidc,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'

vi.mock('#/server/common/helpers/oidc-client.js', () => ({
  getOidcConfig: vi.fn().mockResolvedValue('fake-oidc-config')
}))

vi.mock('openid-client', () => ({
  randomPKCECodeVerifier: vi.fn(() => 'verifier'),
  calculatePKCECodeChallenge: vi.fn(async () => 'challenge'),
  randomState: vi.fn(() => 'state-123'),
  randomNonce: vi.fn(() => 'nonce-123'),
  buildAuthorizationUrl: vi.fn(
    () => new URL('https://login.microsoftonline.com/tenant/authorize')
  ),
  authorizationCodeGrant: vi.fn(async () => ({
    claims: () => ({
      preferred_username: 'test.user@defra.gov.uk',
      email: 'test.user@defra.gov.uk',
      name: 'Test User'
    })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const MINUTE = 60 * 1000
const START = Date.parse('2026-11-04T09:00:00Z')

describe('#signedOutController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function page(query = '') {
    const response = await server.inject({
      method: 'GET',
      url: `/signed-out${query}`
    })

    return { response, $: cheerio.load(response.payload) }
  }

  test('says why the person was signed out after 30 minutes idle', async () => {
    const { response, $ } = await page('?reason=idle')

    expect(response.statusCode).toBe(statusCodes.ok)
    expect($('h1').text().trim()).toBe('You have been signed out')
    expect($('main').text()).toContain(
      'did not use this service for 30 minutes'
    )
    expect($('title').text()).toContain('You have been signed out |')
  })

  test('says why the person was signed out after 8 hours', async () => {
    const { $ } = await page('?reason=expired')

    expect($('main').text()).toContain('8 hours after you signed in')
  })

  test('offers sign-in without a reason too', async () => {
    const { response, $ } = await page()

    expect(response.statusCode).toBe(statusCodes.ok)
    expect($('main a.govuk-button').attr('href')).toBe('/sign-in')
  })

  test('sign-in takes the person back to the page they were on', async () => {
    const { $ } = await page('?reason=idle&returnTo=%2Fmanage%3Ftab%3Dmodels')

    expect($('main a.govuk-button').attr('href')).toBe(
      '/sign-in?returnTo=%2Fmanage%3Ftab%3Dmodels'
    )
  })

  test('ignores a return address that leaves the site', async () => {
    const { $ } = await page(
      '?reason=idle&returnTo=https%3A%2F%2Fattacker.example'
    )

    expect($('main a.govuk-button').attr('href')).toBe('/sign-in')
  })

  test('refuses a reason it does not know', async () => {
    const { response } = await page('?reason=banana')

    expect(response.statusCode).toBe(statusCodes.badRequest)
  })

  test('is open to a signed-out visitor and does not show a signed-in name', async () => {
    const { $ } = await page('?reason=idle')

    expect($('.app-sign-in-out').text()).toContain('Sign in')
    expect($('.app-sign-in-out').text()).not.toContain('Signed in as')
  })

  // The script goes here when time is up by its own clock and it could not
  // confirm with the server (for example a 503), even though another tab may
  // have kept the session alive.
  describe('when the session is still live (another tab renewed it)', () => {
    let cookies

    beforeEach(async () => {
      fetchMock.resetMocks()
      // Only the clock moves: timers the server and its cache use keep running.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(START)
      cookies = await signInViaOidc(server, fetchMock)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const visit = (query = '') =>
      server.inject({
        method: 'GET',
        url: `/signed-out${query}`,
        headers: { cookie: cookieHeader(cookies) }
      })

    const continuePage = async (query) => {
      const response = await visit(query)

      return { response, $: cheerio.load(response.payload) }
    }

    // Not a redirect: the next hop would be a request nobody made, and it
    // would restart the idle time. The person chooses to go on instead.
    test('does not claim a sign-out and does not redirect: it offers Continue to the page they were on', async () => {
      const { response, $ } = await continuePage(
        '?reason=idle&returnTo=%2Fmanage%3Ftab%3Dmodels'
      )

      expect(response.statusCode).toBe(statusCodes.ok)
      expect(response.headers.location).toBeUndefined()
      expect($('h1').text().trim()).toBe('You are still signed in')
      expect($('main').text()).not.toContain('signed out')
      expect($('main a.govuk-button').text().trim()).toBe('Continue')
      expect($('main a.govuk-button').attr('href')).toBe('/manage?tab=models')
    })

    test('offers Continue to the home page when there is no page to return to, or one that leaves the site', async () => {
      const bare = await continuePage('?reason=idle')
      const offSite = await continuePage(
        '?reason=idle&returnTo=https%3A%2F%2Fattacker.example'
      )

      expect(bare.$('main a.govuk-button').attr('href')).toBe('/')
      expect(offSite.$('main a.govuk-button').attr('href')).toBe('/')
    })

    test('leaves the idle clock alone until the person chooses Continue', async () => {
      vi.setSystemTime(START + 20 * MINUTE)

      const { response } = await continuePage(
        '?reason=idle&returnTo=%2Fsession%2Fstatus'
      )
      // Nothing automatic follows: a redirect would be the hop that renews it.
      expect(response.statusCode).toBe(statusCodes.ok)
      expect(response.headers.location).toBeUndefined()

      const status = await server.inject({
        method: 'GET',
        url: '/session/status',
        headers: { cookie: cookieHeader(cookies) }
      })
      expect(status.result.idleSeconds).toBe(10 * 60)
    })

    test('still shows the page once the session has really ended', async () => {
      vi.setSystemTime(START + 31 * MINUTE)

      const { statusCode, payload } = await visit('?reason=idle')

      expect(statusCode).toBe(statusCodes.ok)
      expect(payload).toContain('You have been signed out')
    })
  })
})

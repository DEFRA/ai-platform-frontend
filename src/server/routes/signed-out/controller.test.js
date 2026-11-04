import * as cheerio from 'cheerio'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

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
})

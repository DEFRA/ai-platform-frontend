import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { mockApi } from '#/test-helpers/api-mock.js'
import {
  INFRADEV_URL,
  TEAM_PATH,
  applicationsOf,
  connectionDetails,
  detail,
  environmentsRead,
  federatedApplication,
  operationsAnswer
} from '#/test-helpers/environments-helpers.js'
import {
  signInViaOidc,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
  sampleModel,
  sampleTeam,
  teamWithMembers
} from '#/test-helpers/team-connect-helpers.js'

vi.mock('#/server/common/helpers/oidc-client.js', () => ({
  getOidcConfig: vi.fn().mockResolvedValue('fake-oidc-config')
}))

vi.mock('openid-client', () => ({
  randomPKCECodeVerifier: vi.fn(() => 'verifier'),
  calculatePKCECodeChallenge: vi.fn(async () => 'challenge'),
  randomState: vi.fn(() => 'state-123'),
  randomNonce: vi.fn(() => 'nonce-123'),
  buildAuthorizationUrl: vi.fn(
    () =>
      new URL(
        'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=state-123'
      )
  ),
  authorizationCodeGrant: vi.fn(async () => ({
    access_token: 'user-access-token',
    refresh_token: 'user-refresh-token',
    expires_in: 3600,
    claims: () => ({
      preferred_username: 'test.user@defra.gov.uk',
      email: 'test.user@defra.gov.uk',
      name: 'Test User'
    })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const ENVIRONMENT_PATH = `${TEAM_PATH}/environments/infradev`

function text($, selector) {
  return $(selector).text().replace(/\s+/g, ' ').trim()
}

describe('an environment’s applications and connection details', () => {
  let server
  let cookies

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    fetchMock.resetMocks()
    cookies = await signInViaOidc(server, fetchMock)
  })

  function backend({ role = 'admin', environment = {}, ...routes } = {}) {
    mockApi(fetchMock, {
      'GET /v1/teams': { items: [sampleTeam] },
      'GET /v1/models': { items: [sampleModel] },
      'GET /v1/credentials': { items: [] },
      [`GET ${TEAM_PATH}`]: teamWithMembers(role),
      [`GET ${TEAM_PATH}/environments`]: environmentsRead(),
      [`GET ${ENVIRONMENT_PATH}`]: detail(environment),
      [`GET ${TEAM_PATH}/operations`]: operationsAnswer(),
      ...routes
    })
  }

  async function page(url = INFRADEV_URL) {
    const response = await server.inject({
      method: 'GET',
      url,
      headers: { cookie: cookieHeader(cookies) }
    })

    return { statusCode: response.statusCode, $: load(response.result) }
  }

  describe('Applications (F9)', () => {
    test('says how many of 20 are used and links to Create Passwordless Credential while there is room (AC17)', async () => {
      backend({
        environment: {
          applications: applicationsOf([federatedApplication()], 3)
        }
      })

      const { $ } = await page()

      expect(
        text($, '#applications > .govuk-summary-card__title-wrapper > h2')
      ).toBe('Applications')
      expect(text($, '[data-testid="applications-count"]')).toContain(
        '3 of 20 used'
      )
      expect($('a[data-testid="federate-an-application"]').attr('href')).toBe(
        '/environments/flood-risk-team/federate?environment=infradev'
      )
      expect($('[data-testid="applications-full"]')).toHaveLength(0)
    })

    test('puts Applications in a summary card with Create Passwordless Credential as a button at the right of its title', async () => {
      backend({
        environment: {
          applications: applicationsOf([federatedApplication()], 3)
        }
      })

      const { $ } = await page()
      const card = $('#applications')
      const button = card.find(
        '.app-section-card__actions a.govuk-button[data-testid="federate-an-application"]'
      )

      expect(card.hasClass('govuk-summary-card')).toBe(true)
      expect(button).toHaveLength(1)
      expect(button.text().replace(/\s+/g, ' ').trim()).toBe(
        'Create Passwordless Credential in Infradev'
      )
      expect(card.find('[data-testid="application-row"]')).toHaveLength(1)
      expect($('.govuk-heading-l')).toHaveLength(0)
      expect($('body').text()).not.toContain('Federate an application')
    })

    test('says why a full registration offers no Create Passwordless Credential link (AC17)', async () => {
      backend({
        environment: {
          applications: applicationsOf([federatedApplication()], 20)
        }
      })

      const { $ } = await page()

      expect($('a[data-testid="federate-an-application"]')).toHaveLength(0)
      expect(text($, '[data-testid="applications-full"]')).toBe(
        'Infradev holds 20 applications, the most one environment can. Remove one to federate another here.'
      )
    })

    test('lists each application with where it runs and a tag for its state (AC13)', async () => {
      backend({
        environment: {
          applications: applicationsOf([
            federatedApplication(),
            federatedApplication({
              id: 'app-2',
              name: 'flood-worker',
              status: 'setting-up'
            }),
            federatedApplication({
              id: 'app-3',
              name: 'flood-reports',
              host: 'azure',
              service: undefined,
              status: 'removing'
            })
          ])
        }
      })

      const { $ } = await page()
      const rows = $('[data-testid="application-row"]')

      expect(rows).toHaveLength(3)
      expect(text($, rows.eq(0))).toContain('flood-api')
      expect(text($, rows.eq(0).find('.govuk-tag'))).toBe('Ready to use')
      expect(text($, rows.eq(0))).toContain('CDP service')
      expect(text($, rows.eq(1).find('.govuk-tag'))).toBe('Setting up')
      expect(text($, rows.eq(2).find('.govuk-tag'))).toBe('Removing')
      expect(text($, rows.eq(2))).toContain('Azure managed identity')
    })

    test('shows an admin Change and Remove for a ready application, with the application and environment named (AC18, AC19)', async () => {
      backend({
        environment: {
          applications: applicationsOf([federatedApplication()])
        }
      })

      const { $ } = await page()
      const change = $('a[data-testid="application-change"]')
      const remove = $('a[data-testid="application-remove"]')

      expect(change.attr('href')).toBe(
        `${INFRADEV_URL}/applications/app-1/change`
      )
      expect(change.text().replace(/\s+/g, ' ').trim()).toBe(
        'Change flood-api in Infradev'
      )
      expect(remove.attr('href')).toBe(
        `${INFRADEV_URL}/applications/app-1/remove`
      )
      expect(remove.text().replace(/\s+/g, ' ').trim()).toBe(
        'Remove flood-api from Infradev'
      )
    })

    test('shows a Member the applications but no Change or Remove (AC18)', async () => {
      backend({
        role: 'user',
        environment: {
          applications: applicationsOf([federatedApplication()])
        }
      })

      const { $ } = await page()

      expect($('[data-testid="application-row"]')).toHaveLength(1)
      expect($('a[data-testid="application-change"]')).toHaveLength(0)
      expect($('a[data-testid="application-remove"]')).toHaveLength(0)
      expect($('a[data-testid="federate-an-application"]')).toHaveLength(1)
    })

    test('shows why an application failed and lets an admin remove it', async () => {
      backend({
        environment: {
          applications: applicationsOf([
            federatedApplication({
              status: 'failed',
              failureReason: 'The platform checks refused the change.'
            })
          ])
        }
      })

      const { $ } = await page()

      expect(text($, '[data-testid="application-reason"]')).toBe(
        'The platform checks refused the change.'
      )
      expect($('a[data-testid="application-change"]')).toHaveLength(0)
      expect($('a[data-testid="application-remove"]')).toHaveLength(1)
    })

    test('says there are none yet', async () => {
      backend({ environment: { applications: applicationsOf([]) } })

      const { $ } = await page()

      expect(text($, '[data-testid="no-applications"]')).toBe(
        'No applications are federated in Infradev yet.'
      )
    })

    test('has no Applications section for an environment that is not set up', async () => {
      backend({
        environment: {
          setUp: false,
          limits: null,
          limitBounds: null,
          models: [],
          applications: applicationsOf([])
        }
      })

      const { $ } = await page()

      expect($('h2#applications')).toHaveLength(0)
    })

    test('is in the status fragment, so it follows an application being set up', async () => {
      backend({
        environment: {
          applications: applicationsOf([
            federatedApplication({ status: 'setting-up' })
          ])
        }
      })

      const response = await server.inject({
        method: 'GET',
        url: `${INFRADEV_URL}?fragment=status`,
        headers: { cookie: cookieHeader(cookies) }
      })
      const $ = load(response.result)

      expect(response.statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="application-row"] .govuk-tag').text()).toBe(
        'Setting up'
      )
    })
  })

  describe('Connection details (F11)', () => {
    test('shows each value as text, with a Copy button that stays hidden until script reveals it (AC25)', async () => {
      backend({ environment: { connection: connectionDetails } })

      const { $ } = await page()
      const rows = $('[data-testid="connection-row"]')

      expect(
        text($, '#connection-details > .govuk-summary-card__title-wrapper > h2')
      ).toBe('Connection details')
      expect($('#connection-details').hasClass('govuk-summary-card')).toBe(true)
      expect(
        $('#connection-details').find('[data-testid="connection-row"]')
      ).toHaveLength(7)
      expect(
        rows
          .map((_, row) => $(row).find('dt').text().trim())
          .get()
          .map((key) => key.replace(/\s+/g, ' '))
      ).toEqual([
        'Gateway address',
        'Token endpoint',
        'Client ID',
        'Tenant ID',
        'Scope',
        'Audience For a CDP token',
        'First test call'
      ])
      expect(text($, '#connection-client-id')).toBe(connectionDetails.clientId)
      expect(text($, '#connection-gateway')).toBe(connectionDetails.gatewayUrl)
      expect($('#connection-whoami').text()).toBe(
        'GET https://gateway.example/flood-risk-team/whoami'
      )
      expect($('[data-testid="connection-row"] button[hidden]')).toHaveLength(7)
      expect(
        $('#connection-client-id')
          .closest('dd')
          .find('button')
          .attr('data-copy-target')
      ).toBe('connection-client-id')
      expect(
        $('#connection-client-id').closest('dd').find('button').text().trim()
      ).toBe('Copy client ID')
      expect(
        $('#connection-whoami').closest('dd').find('button').text().trim()
      ).toBe('Copy first test call')
    })

    test('says the values are examples while the backend flags them a placeholder (AC22, AC25)', async () => {
      backend({ environment: { connection: connectionDetails } })

      const { $ } = await page()

      expect(text($, '[data-testid="connection-placeholder-notice"]')).toBe(
        'These are example values. They work once the platform’s Entra set-up is finished.'
      )
    })

    test('has no notice once the values are real', async () => {
      backend({
        environment: {
          connection: { ...connectionDetails, placeholder: false }
        }
      })

      const { $ } = await page()

      expect($('[data-testid="connection-placeholder-notice"]')).toHaveLength(0)
      expect($('#connection-details')).toHaveLength(1)
    })

    test('shows a Member the same details', async () => {
      backend({
        role: 'user',
        environment: { connection: connectionDetails }
      })

      const { $ } = await page()

      expect($('[data-testid="connection-row"]')).toHaveLength(7)
    })

    test('explains how to get a token, the first call and the model call, with the values filled in (AC25, D8)', async () => {
      backend({ environment: { connection: connectionDetails } })

      const { $ } = await page()
      const help = $('details#how-to-get-a-token')

      expect(help.find('summary').text().trim()).toBe('How to get a token')
      expect(help.find('#connection-token-request').text()).toContain(
        `client_id=${connectionDetails.clientId}`
      )
      expect(help.find('#connection-token-whoami').text()).toContain(
        'GET https://gateway.example/flood-risk-team/whoami'
      )
      expect(help.find('#connection-token-model').text()).toContain(
        'POST https://gateway.example/flood-risk-team/openai/v1/chat/completions'
      )
      expect(help.find('#connection-token-model').text()).toContain('gpt-4o')
      expect(help.find('button[hidden]')).toHaveLength(3)
    })

    test('has no Connection details section when the backend gives none', async () => {
      backend({ environment: { connection: null } })

      const { $ } = await page()

      expect($('#connection-details')).toHaveLength(0)
      expect($('details#how-to-get-a-token')).toHaveLength(0)
    })

    test('is outside the status fragment, so the Copy buttons are not swapped out', async () => {
      backend({ environment: { connection: connectionDetails } })

      const response = await server.inject({
        method: 'GET',
        url: `${INFRADEV_URL}?fragment=status`,
        headers: { cookie: cookieHeader(cookies) }
      })

      expect(load(response.result)('#connection-details')).toHaveLength(0)
    })
  })
})

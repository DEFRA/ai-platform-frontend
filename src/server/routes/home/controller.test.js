import { load } from 'cheerio'
import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { mockApi, reply } from '#/test-helpers/api-mock.js'
import {
  signInViaOidc,
  cookieHeader
} from '#/test-helpers/oidc-session-helpers.js'
import {
  nanoModel,
  sampleModel,
  sampleTeam
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
    claims: () => ({ email: 'test.user@defra.gov.uk', name: 'Test User' })
  }))
}))

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const DAY_MS = 24 * 60 * 60 * 1000
const FAILED_ACCESS_ERROR = reply(500, { code: 'internal', message: 'Oops' })

const adminTeam = sampleTeam
const memberTeam = {
  _id: 'team-2',
  slug: 'plant-health-data',
  name: 'Plant Health Data',
  role: 'user'
}

function deployment(overrides = {}) {
  return {
    _id: 'deployment-1',
    teamId: 'team-1',
    modelSlug: 'gpt-4o',
    environment: 'infradev',
    status: 'active',
    ...overrides
  }
}

function ownKey(daysLeft, overrides = {}) {
  return {
    _id: 'cred-1',
    tier: 'research',
    status: 'active',
    modelSlug: 'gpt-4o',
    expiresAt: new Date(Date.now() + daysLeft * DAY_MS).toISOString(),
    renewalsRemaining: 3,
    ...overrides
  }
}

describe('#homeController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    fetchMock.resetMocks()
  })

  async function signedInHome(routes) {
    const cookies = await signInViaOidc(server, fetchMock)

    mockApi(fetchMock, {
      'GET /v1/models': { items: [sampleModel, nanoModel] },
      'GET /v1/teams': { items: [] },
      'GET /v1/credentials': { items: [] },
      ...routes
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: cookieHeader(cookies) }
    })

    return { $: load(result), result, statusCode }
  }

  function lines($, testId) {
    return $(`[data-testid="${testId}"] li`)
      .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
      .get()
  }

  function text($, testId) {
    return $(`[data-testid="${testId}"]`).text().replace(/\s+/g, ' ').trim()
  }

  describe('signed out', () => {
    let $
    let statusCode

    beforeEach(async () => {
      const response = await server.inject({ method: 'GET', url: '/' })

      $ = load(response.result)
      statusCode = response.statusCode
    })

    test('answers with the front door and calls nothing in the backend', () => {
      expect(statusCode).toBe(statusCodes.ok)
      expect($('h1').text().trim()).toBe('Get AI model access')
      expect($('.govuk-body-l').text().trim()).toBe(
        'Use approved AI models in your Defra service. You do not need an Azure account.'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    test('"Start now" signs in, then goes to the models', () => {
      const start = $('a.govuk-button--start')

      expect(start.text().trim()).toBe('Start now')
      expect(start.attr('href')).toBe('/sign-in?returnTo=%2Fmodels')
    })

    test('says who it is for and the two ways to get access, team first', () => {
      expect($('h2').text()).toContain('Who it is for')
      expect($('main').text()).toContain(
        'Anyone at Defra building a service or trying an idea out. Sign in with your Defra account.'
      )
      expect($('h2').text()).toContain('Two ways to get access')
      expect($('h3')).toHaveLength(2)
      expect($('h3').first().text()).toBe('For your team’s service')
      expect($('main').text()).toContain(
        'Your team gets its own deployment of a model in the UK or EU, set up in Development first. Everyone in the team uses it through one client secret.'
      )
      expect($('h3').last().text()).toBe('To try a model on your own')
      expect($('main').text()).toContain(
        'A personal key that works for 7 days, with 60 requests a minute and 100,000 tokens a day. Do not put OFFICIAL-SENSITIVE data through it.'
      )
    })

    test('offers the models without signing in', () => {
      expect($('h2').text()).toContain('Browse without signing in')
      expect($('a[href="/models"]').text()).toContain(
        'See the models you can use'
      )
    })

    test('leaves out the old how it works steps and alpha inset', () => {
      expect($('main').text()).not.toContain('How it works')
      expect($('main').text()).not.toContain('What you get')
      expect($('main').text()).not.toContain('This service is in alpha')
    })
  })

  describe('signed in as a person with only their own keys', () => {
    test('offers the two ways in, team first, and no attention section', async () => {
      const { $, statusCode } = await signedInHome({
        'GET /v1/credentials': { items: [ownKey(10)] }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect($('.govuk-body-l').text().trim()).toBe(
        'Use approved AI models in your Defra service.'
      )
      expect($('[data-testid="home-add-to-team"]').text().trim()).toBe(
        'Add models to a team'
      )
      expect($('[data-testid="home-add-to-team"]').attr('href')).toBe(
        '/connect/team/start'
      )
      expect($('[data-testid="home-try-on-your-own"]').text()).toBe(
        'Try a model on your own'
      )
      expect($('[data-testid="home-try-on-your-own"]').attr('href')).toBe(
        '/connect/shared/start'
      )
      expect($('h2').text()).not.toContain('Needs your attention')
    })

    test('says they are in no team and what their key is and when it expires', async () => {
      const key = ownKey(10)
      const { $ } = await signedInHome({
        'GET /v1/credentials': { items: [key] }
      })

      expect($('h2').text()).toContain('Your teams')
      expect(text($, 'home-teams-empty')).toBe(
        'You are not a member of a team yet.'
      )
      expect(text($, 'home-keys')).toBe(
        `You have 1 key, for GPT-4o. It expires on ${formatDate(key.expiresAt)}. Go to Your access`
      )
      expect($('[data-testid="home-keys"] a').attr('href')).toBe('/manage')
    })

    test('says they have no keys of their own, with no link to Your access', async () => {
      const { $ } = await signedInHome({})

      expect(text($, 'home-keys')).toBe('You have no keys of your own.')
      expect($('[data-testid="home-keys"] a')).toHaveLength(0)
    })

    test('counts several keys and names the first to expire', async () => {
      const soonest = ownKey(5, { _id: 'cred-2', modelSlug: 'gpt-4-1-nano' })
      const { $ } = await signedInHome({
        'GET /v1/credentials': { items: [ownKey(9), soonest] }
      })

      expect(text($, 'home-keys')).toBe(
        `You have 2 keys, for GPT-4.1 nano and GPT-4o. The first expires on ${formatDate(soonest.expiresAt)}. Go to Your access`
      )
    })

    test('does not count a key that has run out, or one that never issued', async () => {
      const { $ } = await signedInHome({
        'GET /v1/credentials': {
          items: [
            ownKey(-2, { status: 'expired' }),
            ownKey(10, { _id: 'cred-3', status: 'revoked' }),
            ownKey(10, { _id: 'cred-4', status: 'pending' })
          ]
        }
      })

      expect(text($, 'home-keys')).toBe('You have no keys of your own.')
      expect($('h2').text()).not.toContain('Needs your attention')
    })

    test('calls out a key that runs out within 3 days, with a way to renew it', async () => {
      const key = ownKey(2)
      const { $ } = await signedInHome({
        'GET /v1/credentials': { items: [key] }
      })

      expect($('h2').text()).toContain('Needs your attention')
      expect(lines($, 'home-attention')).toEqual([
        `Your key for GPT-4o runs out on ${formatDate(key.expiresAt)}. Renew it`
      ])
      expect($('[data-testid="home-attention"] a').attr('href')).toBe(
        '/manage/credentials/cred-1'
      )
    })

    test('does not call out a key with more than 3 days left, and no longer shows a banner', async () => {
      const { $, result } = await signedInHome({
        'GET /v1/credentials': { items: [ownKey(4)] }
      })

      expect($('h2').text()).not.toContain('Needs your attention')
      expect(result).not.toContain('govuk-notification-banner')
    })

    test('does not show a team’s client secret among their own keys', async () => {
      const { $ } = await signedInHome({
        'GET /v1/credentials': {
          items: [
            {
              _id: 'cred-team-1',
              tier: 'team',
              teamId: 'team-1',
              status: 'active',
              environment: 'infradev',
              expiresAt: null
            }
          ]
        }
      })

      expect(text($, 'home-keys')).toBe('You have no keys of your own.')
    })
  })

  describe('signed in as a team admin', () => {
    test('links the team to its Models tab with the models it has ready, by environment', async () => {
      const { $ } = await signedInHome({
        'GET /v1/teams': { items: [adminTeam] },
        [`GET /v1/teams/${adminTeam.slug}/deployments`]: {
          items: [
            deployment(),
            deployment({ _id: 'deployment-2', modelSlug: 'gpt-4-1-nano' }),
            deployment({ _id: 'deployment-3', environment: 'qa' })
          ]
        }
      })

      expect(text($, 'home-team')).toBe(
        'Flood Risk Team Admin. GPT-4.1 nano and GPT-4o in Development. GPT-4o in Test.'
      )
      expect($('[data-testid="home-team"] a').attr('href')).toBe(
        '/teams/flood-risk-team'
      )
    })

    test('names a model that could not be set up, with a way to see what happened', async () => {
      const { $ } = await signedInHome({
        'GET /v1/teams': { items: [adminTeam] },
        [`GET /v1/teams/${adminTeam.slug}/deployments`]: {
          items: [
            deployment({ _id: 'deployment-9', status: 'deploy-failed' }),
            deployment({ _id: 'deployment-2', modelSlug: 'gpt-4-1-nano' })
          ]
        }
      })

      expect(lines($, 'home-attention')).toEqual([
        'GPT-4o could not be set up for Flood Risk Team. See what happened'
      ])
      expect($('[data-testid="home-attention"] a').attr('href')).toBe(
        '/connect/team/request/flood-risk-team/deployment-9'
      )
      expect(text($, 'home-team')).toBe(
        'Flood Risk Team Admin. GPT-4.1 nano in Development.'
      )
    })

    test('says so when the team has no model yet', async () => {
      const { $ } = await signedInHome({
        'GET /v1/teams': { items: [adminTeam] },
        [`GET /v1/teams/${adminTeam.slug}/deployments`]: { items: [] }
      })

      expect(text($, 'home-team')).toBe('Flood Risk Team Admin. No models yet.')
      expect($('h2').text()).not.toContain('Needs your attention')
    })

    test('leaves out a model that was removed or is being removed', async () => {
      const { $ } = await signedInHome({
        'GET /v1/teams': { items: [adminTeam] },
        [`GET /v1/teams/${adminTeam.slug}/deployments`]: {
          items: [
            deployment({ status: 'removed' }),
            deployment({ _id: 'deployment-2', status: 'removing' })
          ]
        }
      })

      expect(text($, 'home-team')).toBe('Flood Risk Team Admin. No models yet.')
      expect($('h2').text()).not.toContain('Needs your attention')
    })
  })

  describe('signed in as a team member', () => {
    test('says they are a member and that a model is setting up, with a way to check progress', async () => {
      const { $ } = await signedInHome({
        'GET /v1/teams': { items: [memberTeam] },
        [`GET /v1/teams/${memberTeam.slug}/deployments`]: {
          items: [
            deployment({
              _id: 'deployment-5',
              teamId: 'team-2',
              status: 'committed'
            })
          ]
        }
      })

      expect(text($, 'home-team')).toBe(
        'Plant Health Data Member. GPT-4o setting up.'
      )
      expect(lines($, 'home-attention')).toEqual([
        'GPT-4o is being set up for Plant Health Data. Check progress'
      ])
      expect($('[data-testid="home-attention"] a').attr('href')).toBe(
        '/connect/team/request/plant-health-data/deployment-5'
      )
    })

    test('lists failures, then set-ups in progress, then keys, across all their teams', async () => {
      const key = ownKey(1)
      const { $ } = await signedInHome({
        'GET /v1/teams': { items: [memberTeam, adminTeam] },
        'GET /v1/credentials': { items: [key] },
        [`GET /v1/teams/${memberTeam.slug}/deployments`]: {
          items: [deployment({ status: 'queued' })]
        },
        [`GET /v1/teams/${adminTeam.slug}/deployments`]: {
          items: [
            deployment({
              _id: 'deployment-7',
              modelSlug: 'gpt-4-1-nano',
              status: 'checks-failed'
            })
          ]
        }
      })

      expect(lines($, 'home-attention')).toEqual([
        'GPT-4.1 nano could not be set up for Flood Risk Team. See what happened',
        'GPT-4o is being set up for Plant Health Data. Check progress',
        `Your key for GPT-4o runs out on ${formatDate(key.expiresAt)}. Renew it`
      ])
      expect($('[data-testid="home-team"]')).toHaveLength(2)
    })

    test('shows both a model ready and one setting up, in a sentence each', async () => {
      const { $ } = await signedInHome({
        'GET /v1/teams': { items: [memberTeam] },
        [`GET /v1/teams/${memberTeam.slug}/deployments`]: {
          items: [
            deployment(),
            deployment({
              _id: 'deployment-2',
              modelSlug: 'gpt-4-1-nano',
              status: 'deploying'
            })
          ]
        }
      })

      expect(text($, 'home-team')).toBe(
        'Plant Health Data Member. GPT-4o in Development. GPT-4.1 nano setting up.'
      )
    })
  })

  describe('when the backend cannot answer', () => {
    test('says it could not check the teams, and still shows the keys', async () => {
      const { $, statusCode } = await signedInHome({
        'GET /v1/teams': FAILED_ACCESS_ERROR,
        'GET /v1/credentials': { items: [ownKey(10)] }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(text($, 'home-teams-unavailable')).toBe(
        'We could not check your teams just now.'
      )
      expect(text($, 'home-keys')).toContain('You have 1 key, for GPT-4o.')
    })

    test('says it could not check the keys, and still shows the teams', async () => {
      const { $, statusCode } = await signedInHome({
        'GET /v1/credentials': FAILED_ACCESS_ERROR,
        'GET /v1/teams': { items: [adminTeam] },
        [`GET /v1/teams/${adminTeam.slug}/deployments`]: {
          items: [deployment()]
        }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect(text($, 'home-keys-unavailable')).toBe(
        'We could not check your keys just now.'
      )
      expect(text($, 'home-team')).toContain('Admin. GPT-4o in Development.')
    })

    test('says it could not check one team’s models, without calling them none, or blocking the rest', async () => {
      const { $, statusCode } = await signedInHome({
        'GET /v1/teams': { items: [adminTeam, memberTeam] },
        [`GET /v1/teams/${adminTeam.slug}/deployments`]: FAILED_ACCESS_ERROR,
        [`GET /v1/teams/${memberTeam.slug}/deployments`]: {
          items: [deployment()]
        }
      })

      expect(statusCode).toBe(statusCodes.ok)
      expect($('[data-testid="home-team"]').first().text()).toContain(
        'We could not check its models just now.'
      )
      expect($('[data-testid="home-team"]').last().text()).toContain(
        'Member. GPT-4o in Development.'
      )
      expect($('h2').text()).not.toContain('Needs your attention')
    })

    test('falls back to the model’s slug when the names cannot be read', async () => {
      const { $ } = await signedInHome({
        'GET /v1/models': FAILED_ACCESS_ERROR,
        'GET /v1/teams': { items: [adminTeam] },
        [`GET /v1/teams/${adminTeam.slug}/deployments`]: {
          items: [deployment()]
        }
      })

      expect(text($, 'home-team')).toContain('Admin. gpt-4o in Development.')
    })
  })

  test('escapes the team and model names', async () => {
    const teamName = '<img src=x onerror=alert(1)>'
    const { result } = await signedInHome({
      'GET /v1/models': {
        items: [{ ...sampleModel, displayName: '<b>GPT-4o</b>' }]
      },
      'GET /v1/teams': { items: [{ ...adminTeam, name: teamName }] },
      [`GET /v1/teams/${adminTeam.slug}/deployments`]: {
        items: [deployment({ status: 'deploy-failed' }), deployment()]
      }
    })

    expect(result).not.toContain(teamName)
    expect(result).not.toContain('<b>GPT-4o</b>')
    expect(result).toContain('&lt;b&gt;GPT-4o&lt;/b&gt; could not be set up')
    expect(result).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

import createFetchMock from 'vitest-fetch-mock'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
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

const sampleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai',
  family: 'gpt-4o',
  version: '2024-08-06',
  description: 'Multimodal OpenAI model.',
  region: 'uksouth',
  regions: ['uksouth'],
  dataZone: 'uk',
  eligible: true,
  researchAvailable: true,
  tiers: ['research', 'team'],
  skus: [
    { name: 'Standard', tiers: ['team'], regions: ['uksouth'] },
    { name: 'Standard', tiers: ['research'], regions: ['uksouth'] }
  ],
  useCases: ['Chat assistants', 'Summarising documents', 'Reading images'],
  deploymentName: 'gpt-4o',
  apiVersion: '2024-05-01-preview',
  limitsDefault: { requestsPerMinute: 60, tokensPerDay: 100000 }
}

const researchOnlyModel = {
  ...sampleModel,
  slug: 'gpt-5-mini',
  displayName: 'GPT-5 mini',
  tiers: ['research'],
  regions: ['swedencentral'],
  skus: [
    {
      name: 'DataZoneStandard',
      tiers: ['research'],
      regions: ['swedencentral']
    }
  ],
  useCases: ['Chat assistants', 'Writing code']
}

// Only a worldwide deployment, so it is never usable, even in a UK region.
const worldwideOnlyModel = {
  ...sampleModel,
  slug: 'gpt-5-nano',
  displayName: 'GPT-5 nano',
  researchAvailable: false,
  skus: [
    {
      name: 'GlobalStandard',
      tiers: ['research', 'team'],
      regions: ['uksouth']
    }
  ],
  useCases: ['Simple chat']
}

const swedenModel = {
  ...sampleModel,
  slug: 'gpt-4-1-nano',
  displayName: 'GPT-4.1 nano',
  researchAvailable: false,
  tiers: ['team'],
  skus: [{ name: 'Standard', tiers: ['team'], regions: ['swedencentral'] }],
  regions: ['swedencentral'],
  useCases: ['Prototyping', 'Simple chat']
}

const usModel = {
  ...sampleModel,
  slug: 'gpt-4-1-mini',
  displayName: 'GPT-4.1 mini',
  researchAvailable: false,
  tiers: ['team'],
  skus: [{ name: 'Standard', tiers: ['team'], regions: ['eastus'] }],
  regions: ['eastus'],
  useCases: ['Summarising documents']
}

const teamOnlyModel = {
  ...sampleModel,
  slug: 'team-only',
  displayName: 'Team only model',
  researchAvailable: false,
  tiers: ['team']
}

// Offered to research by the catalogue, in the UK, but research has not deployed it.
const notDeployedModel = {
  ...sampleModel,
  slug: 'o3-mini',
  displayName: 'o3-mini',
  researchAvailable: false,
  useCases: ['Reasoning']
}

const duplicateModel = {
  ...sampleModel,
  slug: 'gpt-4o-2',
  displayName: 'GPT-4o (capacity 2)'
}

const embeddingModel = {
  ...sampleModel,
  slug: 'text-embedding-ada-002',
  displayName: 'text-embedding-ada-002',
  eligible: false,
  researchAvailable: false,
  eligibilityReason: 'Embeddings are not supported on the platform yet.',
  tiers: [],
  skus: [],
  useCases: []
}

const catalogue = {
  items: [
    sampleModel,
    researchOnlyModel,
    worldwideOnlyModel,
    swedenModel,
    usModel,
    notDeployedModel,
    duplicateModel,
    embeddingModel
  ]
}

function rowFor(result, displayName) {
  const rows = result.split('data-testid="model-table-row"').slice(1)

  return rows.find((row) => row.includes(`>${displayName}</a>`))
}

describe('#modelsController', () => {
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

  async function getModels(url = '/models', cookies) {
    fetchMock.mockResponseOnce(JSON.stringify(catalogue))

    return server.inject({
      method: 'GET',
      url,
      headers: cookies ? { cookie: cookieHeader(cookies) } : {}
    })
  }

  describe('GET /models', () => {
    test('is public and has the heading, lead and both ways in', async () => {
      const { statusCode, result } = await getModels()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('>Models</h1>')
      expect(result).toContain(
        'Add a model to your team, or try one on your own first.'
      )
      expect(result).toMatch(
        /<a href="\/connect\/team\/start"[^>]*>\s*Add models to a team\s*<\/a>/
      )
      expect(result).toMatch(
        /href="\/connect\/shared\/start"[^>]*>Try a model on your own for 7 days<\/a>/
      )
    })

    test('asks the backend for the whole catalogue, ineligible models included, with no tier or provider', async () => {
      await getModels('/models?show=team')

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/models\?includeIneligible=true$/),
        expect.anything()
      )
    })

    test('has a "Show" select with three choices, Apply and Clear, and no provider filter', async () => {
      const { result } = await getModels()

      expect(result).toMatch(/<label[^>]*for="show"[^>]*>\s*Show\s*<\/label>/)
      expect(result).toContain('All models')
      expect(result).toContain('Models you can add to a team')
      expect(result).toContain('Models you can try on your own')
      expect(result).toMatch(/<button[^>]*>\s*Apply\s*<\/button>/)
      expect(result).toMatch(
        /href="\/models" data-testid="models-clear-filters">Clear<\/a>/
      )
      expect(result).not.toContain('id="provider"')
      expect(result).not.toContain('All providers')
    })

    test('has the columns Model, Good for, Try on your own and Add to a team, and no tags', async () => {
      const { result } = await getModels()

      expect(result).toMatch(/Model\s*<\/th>/)
      expect(result).toMatch(/Good for\s*<\/th>/)
      expect(result).toMatch(/Try on your own\s*<\/th>/)
      expect(result).toMatch(/Add to a team\s*<\/th>/)
      expect(result).not.toContain('govuk-tag--')
    })

    test('says what each model is good for', async () => {
      const { result } = await getModels()

      expect(rowFor(result, 'GPT-4o')).toContain(
        'Chat assistants, summarising documents, reading images'
      )
    })

    test('offers "Try it" and "Add to a team" with the model for one that runs in the UK or EU', async () => {
      const { result } = await getModels()
      const row = rowFor(result, 'GPT-4o')

      expect(row).toContain('href="/connect/shared/start?modelSlug=gpt-4o"')
      expect(row).toContain('href="/connect/team/start?modelSlug=gpt-4o"')
      expect(row).toContain('Runs in the UK or EU')
    })

    test('says "Runs in the UK or EU" and links to add it for a team SKU in Sweden Central', async () => {
      const { result } = await getModels()
      const row = rowFor(result, 'GPT-4.1 nano')

      expect(row).toContain('Runs in the UK or EU')
      expect(row).toContain('href="/connect/team/start?modelSlug=gpt-4-1-nano"')
    })

    test('says "Not for teams yet" with no link for a model with no team SKU, and offers it to try in Sweden Central', async () => {
      const { result } = await getModels()
      const row = rowFor(result, 'GPT-5 mini')

      expect(row).toContain('Not for teams yet')
      expect(row).toContain('href="/connect/shared/start?modelSlug=gpt-5-mini"')
      expect(row).not.toContain('/connect/team/start')
    })

    test('says "Not in the UK or EU yet" with no link for a model whose team SKU is in the US', async () => {
      const { result } = await getModels()
      const row = rowFor(result, 'GPT-4.1 mini')

      expect(row).toContain('Not in the UK or EU yet')
      expect(row).not.toContain('/connect/team/start')
    })

    test('offers a model with only a worldwide SKU to nobody, and says "Not available" to try it', async () => {
      const { result } = await getModels()
      const row = rowFor(result, 'GPT-5 nano')

      expect(row).toContain('Not available')
      expect(row).not.toContain('/connect/shared/start')
      expect(row).toContain('Not in the UK or EU yet')
      expect(row).not.toContain('/connect/team/start')
    })

    test('hides a capacity duplicate', async () => {
      const { result } = await getModels()

      expect(result).not.toContain('GPT-4o (capacity 2)')
    })

    test('puts an ineligible model under "Not available yet", in bold, with its reason', async () => {
      const { result } = await getModels()

      expect(result).toContain('>Not available yet</h2>')
      expect(result).toMatch(
        /govuk-summary-list__key[^>]*>\s*text-embedding-ada-002\s*<\/dt>\s*<dd[^>]*>\s*Embeddings are not supported on the platform yet\./
      )
      expect(result).not.toContain('>text-embedding-ada-002</a>')
    })

    test('falls back to "Not approved yet" when the catalogue gives no reason', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          items: [{ ...embeddingModel, eligibilityReason: undefined }]
        })
      )

      const { result } = await server.inject({ method: 'GET', url: '/models' })

      expect(result).toContain('Not approved yet')
    })

    test('says Retired for a retired model', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          items: [
            {
              ...embeddingModel,
              eligibilityReason: undefined,
              lifecycle: { status: 'retired' }
            }
          ]
        })
      )

      const { result } = await server.inject({ method: 'GET', url: '/models' })

      expect(result).toMatch(/govuk-summary-list__value[^>]*>\s*Retired\s*</)
    })

    test('"Models you can add to a team" lists only those that run in the UK or EU', async () => {
      const { result } = await getModels('/models?show=team')

      expect(result).toContain('>GPT-4o</a>')
      expect(result).toContain('>GPT-4.1 nano</a>')
      expect(result).not.toContain('>GPT-5 mini</a>')
      expect(result).not.toContain('>GPT-4.1 mini</a>')
      expect(result).not.toContain('>GPT-5 nano</a>')
      expect(result).not.toContain('Not available yet')
      expect(result).toMatch(/<option value="team"[^>]*selected/)
    })

    test('"Models you can try on your own" lists only those the backend says are research available', async () => {
      const { result } = await getModels('/models?show=research')

      expect(result).toContain('>GPT-4o</a>')
      expect(result).toContain('>GPT-5 mini</a>')
      expect(result).not.toContain('>GPT-4.1 nano</a>')
      expect(result).not.toContain('>GPT-5 nano</a>')
      expect(result).not.toContain('>o3-mini</a>')
      expect(result).toMatch(/<option value="research"[^>]*selected/)
    })

    test('says "Not available" with no "Try it" link for an eligible model research has not deployed', async () => {
      const { result } = await getModels()
      const row = rowFor(result, 'o3-mini')

      expect(row).toContain('Not available')
      expect(row).not.toContain('/connect/shared/start')
      expect(row).toContain('href="/connect/team/start?modelSlug=o3-mini"')
    })

    test('does not work research availability out from the catalogue', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          items: [{ ...sampleModel, researchAvailable: undefined }]
        })
      )

      const { result } = await server.inject({ method: 'GET', url: '/models' })

      expect(rowFor(result, 'GPT-4o')).not.toContain('/connect/shared/start')
    })

    test('"Models you can try on your own" leaves out a model not offered to research', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ items: [sampleModel, teamOnlyModel] })
      )

      const { result } = await server.inject({
        method: 'GET',
        url: '/models?show=research'
      })

      expect(result).toContain('>GPT-4o</a>')
      expect(result).not.toContain('>Team only model</a>')
    })

    test('follows the existing error handling when the backend cannot read what research has deployed (502)', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          code: 'research-deployments-unavailable',
          message: 'Cannot read'
        }),
        { status: 502 }
      )

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/models'
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
      expect(result).toContain('Something went wrong')
    })

    test('says so when nothing matches', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [researchOnlyModel] }))

      const { result } = await server.inject({
        method: 'GET',
        url: '/models?show=team'
      })

      expect(result).toContain('data-testid="model-table-empty"')
    })

    test('refuses a "show" it does not know', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/models?show=everything'
      })

      expect(statusCode).toBe(statusCodes.badRequest)
    })

    test('ignores the old provider and tier filters', async () => {
      const { statusCode, result } = await getModels(
        '/models?provider=openai&tier=research'
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('>GPT-5 mini</a>')
    })

    // The page offers what a model can do, not what a person may do, so a
    // person with only their own keys, a team member and a team admin all see
    // the same page and make no team lookup: who is in which team is the next
    // step's business (choosing a team).
    test('is the same signed in as signed out, and looks up no team', async () => {
      const cookies = await signInViaOidc(server, fetchMock)
      const signedOut = await getModels()
      const signedIn = await getModels('/models', cookies)

      expect(signedIn.statusCode).toBe(statusCodes.ok)
      expect(rowFor(signedIn.result, 'GPT-4o')).toContain(
        '/connect/team/start?modelSlug=gpt-4o'
      )
      expect(rowFor(signedIn.result, 'GPT-4.1 nano')).toBe(
        rowFor(signedOut.result, 'GPT-4.1 nano')
      )
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringContaining('/v1/teams'),
        expect.anything()
      )
    })
  })

  describe('GET /models/{slug}', () => {
    // The model's page reads the model, then the list, which carries whether
    // it can be tried on your own.
    async function getDetail(model = sampleModel, cookies) {
      fetchMock.mockResponseOnce(JSON.stringify(model))
      fetchMock.mockResponseOnce(JSON.stringify({ items: [model] }))

      return server.inject({
        method: 'GET',
        url: `/models/${model.slug}`,
        headers: cookies ? { cookie: cookieHeader(cookies) } : {}
      })
    }

    test('is public, with a back link, the provider above the name, and what it is good for', async () => {
      const { statusCode, result } = await getDetail()

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(/href="\/models"[^>]*>\s*Back to models\s*<\/a>/)
      expect(result).toMatch(
        /govuk-caption-xl[^>]*>OpenAI<\/span>\s*<h1[^>]*>GPT-4o<\/h1>/
      )
      expect(result).toContain(
        'Good for chat assistants, summarising documents and reading images.'
      )
    })

    test('offers "Add to a team" and "Try it on your own" with the model for one that runs in the UK or EU', async () => {
      const { result } = await getDetail()

      expect(result).toMatch(
        /href="\/connect\/team\/start\?modelSlug=gpt-4o"[^>]*>\s*Add to a team\s*<\/a>/
      )
      expect(result).toMatch(
        /href="\/connect\/shared\/start\?modelSlug=gpt-4o"[^>]*>Try it on your own<\/a>/
      )
    })

    test('puts the actions before "How you can use it"', async () => {
      const { result } = await getDetail()

      expect(result.indexOf('Add to a team')).toBeGreaterThan(-1)
      expect(result.indexOf('Add to a team')).toBeLessThan(
        result.indexOf('How you can use it')
      )
    })

    test('says what each kind of access means, and that the version is pinned', async () => {
      const { result } = await getDetail()

      expect(result).toContain('>How you can use it</h2>')
      expect(result).toContain(
        'A deployment just for your team, in UK South. Shared by the team through one client secret.'
      )
      expect(result).toContain(
        'A personal key for 7 days. Requests can be processed in the UK or the EU, so do not use OFFICIAL-SENSITIVE data.'
      )
      expect(result).not.toContain('outside the UK')
      expect(result).toContain(
        '2024-08-06. Pinned, so it will not change under you.'
      )
    })

    test.each([
      ['swedencentral', 'Sweden Central'],
      ['northeurope', 'North Europe'],
      ['westeurope', 'West Europe'],
      ['ukwest', 'UK West'],
      ['SwedenCentral', 'Sweden Central']
    ])(
      'names the region, %s, a team deployment would run in',
      async (region, label) => {
        const { result } = await getDetail({
          ...swedenModel,
          regions: undefined,
          skus: [
            { name: 'DataZoneStandard', tiers: ['team'], regions: [region] }
          ]
        })

        expect(result).toContain(
          `A deployment just for your team, in ${label}. Shared by the team through one client secret.`
        )
        expect(result).toMatch(
          /href="\/connect\/team\/start\?modelSlug=gpt-4-1-nano"[^>]*>\s*Add to a team\s*<\/a>/
        )
      }
    )

    test('has no "Add to a team" button, and says "Not for teams yet", for a model with no team SKU', async () => {
      const { result } = await getDetail(researchOnlyModel)

      expect(result).not.toContain('/connect/team/start')
      expect(result).toContain('Not for teams yet')
      expect(result).toContain('Try it on your own')
    })

    test('has no "Add to a team" button, and says "Not in the UK or EU yet", for a model whose team SKU is in the US', async () => {
      const { result } = await getDetail(usModel)

      expect(result).not.toContain('/connect/team/start')
      expect(result).toContain('Not in the UK or EU yet')
    })

    test('offers neither action for a model with only a worldwide SKU', async () => {
      const { result } = await getDetail(worldwideOnlyModel)

      expect(result).not.toContain('/connect/team/start')
      expect(result).not.toContain('/connect/shared/start')
      expect(result).not.toContain('Try it on your own')
      expect(result).toContain('Not in the UK or EU yet')
      expect(result).toContain('Not available to try on your own yet.')
    })

    test('has no "Try it on your own" link for a model that cannot be tried', async () => {
      const { result } = await getDetail(teamOnlyModel)

      expect(result).not.toContain('/connect/shared/start')
      expect(result).toContain('Add to a team')
      expect(result).toContain('Not available to try on your own yet.')
    })

    test('has no "Try it on your own" link for an eligible model research has not deployed', async () => {
      const { statusCode, result } = await getDetail(notDeployedModel)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toContain('/connect/shared/start')
      expect(result).not.toContain('Try it on your own')
      expect(result).toContain('Not available to try on your own yet.')
      expect(result).toContain('/connect/team/start?modelSlug=o3-mini')
    })

    test('asks the list for whether the model can be tried', async () => {
      await getDetail()

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/models\?includeIneligible=true$/),
        expect.anything()
      )
    })

    test('does not hide a failed read of the list, whatever its code', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(sampleModel))
      fetchMock.mockResponseOnce(
        JSON.stringify({
          code: 'research-deployments-unavailable',
          message: 'Cannot read'
        }),
        { status: 502 }
      )

      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/models/gpt-4o'
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('has neither action, and says why, for a model that is not available', async () => {
      const { statusCode, result } = await getDetail(embeddingModel)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toContain('/connect/team/start')
      expect(result).not.toContain('/connect/shared/start')
      expect(result).toContain(
        'Not available yet. Embeddings are not supported on the platform yet.'
      )
    })

    test('does not promise a team deployment for an ineligible model that keeps its team SKU', async () => {
      const { result } = await getDetail({
        ...sampleModel,
        eligible: false,
        eligibilityReason: 'Withdrawn for review.'
      })

      expect(result).toContain('Not available yet. Withdrawn for review.')
      expect(result).not.toContain('A deployment just for your team')
      expect(result).toContain('Not available to add to a team yet.')
      expect(result).toContain('Not available to try on your own yet.')
      expect(result).not.toContain('/connect/team/start')
    })

    test('leaves out the lead when the model has no use cases', async () => {
      const { result } = await getDetail({ ...sampleModel, useCases: [] })

      expect(result).not.toContain('Good for')
    })

    test('shows the real gateway request with the code tabs, then one line on what is needed', async () => {
      const { result } = await getDetail({
        ...sampleModel,
        apiProfile: 'chat-completions'
      })

      expect(result).toContain('>Call it from your code</h2>')
      expect(result).toContain(
        'https://apim-aip-infradev.azure-api.net/research/openai/deployments/gpt-4o/chat/completions'
      )
      expect(result).toContain('Copy code')
      expect(result).toContain(
        'You need a client secret or a key before this will work.'
      )
      expect(result).not.toContain('request shape for the research tier')
    })

    test('follows the configured research environment for the host', async () => {
      config.set('researchEnvironment', 'sandbox')

      const { result } = await getDetail()

      config.set('researchEnvironment', 'infradev')

      expect(result).toContain(
        'https://deploytestdefra.azure-api.net/research/'
      )
    })

    test('does not show the old summary, tags or best-practice links', async () => {
      const { result } = await getDetail({
        ...sampleModel,
        links: [{ text: 'Best practice guide', href: '/help/best-practice' }]
      })

      expect(result).not.toContain('Requests per minute')
      expect(result).not.toContain('Tokens per day')
      expect(result).not.toContain('Connect to this model')
      expect(result).not.toContain('Best practice')
      expect(result).not.toContain('hosted by')
    })

    test('is the same, with the same actions, when signed in', async () => {
      const cookies = await signInViaOidc(server, fetchMock)

      const { statusCode, result } = await getDetail(sampleModel, cookies)

      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('/connect/team/start?modelSlug=gpt-4o')
      expect(result).toContain('/connect/shared/start?modelSlug=gpt-4o')
    })

    test('shows a not found page for a model that does not exist', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ code: 'not-found', message: 'No such model' }),
        { status: 404 }
      )

      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: '/models/nope'
      })

      expect(statusCode).toBe(statusCodes.notFound)
      expect(result).toContain('Model not found')
    })

    test('does not hide any other backend failure as not found', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ code: 'server-error', message: 'Broken' }),
        { status: 500 }
      )

      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/models/gpt-4o'
      })

      expect(statusCode).toBe(statusCodes.internalServerError)
    })

    test('refuses a slug that is not one', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/models/Not_A_Slug'
      })

      expect(statusCode).toBe(statusCodes.badRequest)
    })
  })
})

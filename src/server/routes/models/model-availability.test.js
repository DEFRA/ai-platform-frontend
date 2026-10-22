import {
  SHOW_OPTIONS,
  TEAM_AVAILABILITY,
  canTry,
  filterByShow,
  groupModels,
  isCapacityDuplicate,
  isEligible,
  teamAvailability,
  teamRegion,
  unavailableReason,
  useCasesList,
  useCasesSentence
} from './model-availability.js'

const UK_TEAM_SKU = { name: 'DataZoneStandard', tiers: ['team'] }
const RESEARCH_SKU = { name: 'Standard', tiers: ['research'] }
const WORLDWIDE_SKU = { name: 'GlobalStandard', tiers: ['research', 'team'] }

function model(fields = {}) {
  return {
    slug: 'gpt-4o',
    eligible: true,
    tiers: ['research', 'team'],
    regions: ['uksouth'],
    skus: [UK_TEAM_SKU, RESEARCH_SKU],
    ...fields
  }
}

describe('model-availability', () => {
  describe('canTry', () => {
    test('is true for an eligible model offered to research', () => {
      expect(canTry(model())).toBe(true)
    })

    test('is true when the catalogue does not say whether it is eligible', () => {
      expect(canTry(model({ eligible: undefined }))).toBe(true)
    })

    test.each(['swedencentral', 'northeurope', 'westeurope', 'ukwest'])(
      'is true for a research SKU in %s, such as DataZoneStandard',
      (region) => {
        const skus = [
          { name: 'DataZoneStandard', tiers: ['research'], regions: [region] }
        ]

        expect(canTry(model({ skus }))).toBe(true)
      }
    )

    test.each([
      ['is not eligible', { eligible: false }],
      ['is not offered to research', { tiers: ['team'] }],
      ['has no tiers', { tiers: undefined }],
      ['has no SKUs', { skus: undefined }],
      ['has only a team SKU', { skus: [UK_TEAM_SKU] }],
      [
        'has a research SKU only in the US',
        { skus: [{ ...RESEARCH_SKU, regions: ['eastus'] }] }
      ],
      [
        'has a research SKU in the UK and the US',
        { skus: [{ ...RESEARCH_SKU, regions: ['uksouth', 'eastus'] }] }
      ],
      [
        'has a research SKU with no regions',
        { regions: [], skus: [RESEARCH_SKU] }
      ],
      [
        'has only a worldwide SKU, even in the UK',
        {
          skus: [
            {
              name: 'GlobalStandard',
              tiers: ['research'],
              regions: ['uksouth']
            }
          ]
        }
      ],
      [
        'has only a worldwide SKU, in lower or mixed case of region',
        { skus: [{ ...WORLDWIDE_SKU, regions: ['UKSouth'] }] }
      ]
    ])('is false for a model that %s', (_why, fields) => {
      expect(canTry(model(fields))).toBe(false)
    })

    test('is true when a usable research SKU sits beside a worldwide one', () => {
      expect(canTry(model({ skus: [WORLDWIDE_SKU, RESEARCH_SKU] }))).toBe(true)
    })
  })

  describe('teamAvailability', () => {
    test('says "Runs in the UK or EU" for a team SKU that takes the model’s UK regions', () => {
      expect(teamAvailability(model())).toBe(TEAM_AVAILABILITY.inRegions)
      expect(TEAM_AVAILABILITY.inRegions).toBe('Runs in the UK or EU')
    })

    test('says "Runs in the UK or EU" for a team SKU whose own regions are all allowed, in any case', () => {
      const skus = [{ ...UK_TEAM_SKU, regions: ['UKSouth', 'ukwest'] }]

      expect(teamAvailability(model({ skus, regions: ['eastus'] }))).toBe(
        TEAM_AVAILABILITY.inRegions
      )
    })

    test.each(['swedencentral', 'northeurope', 'westeurope'])(
      'says "Runs in the UK or EU" for a team SKU in %s',
      (region) => {
        const skus = [{ ...UK_TEAM_SKU, regions: [region] }]

        expect(teamAvailability(model({ skus }))).toBe(
          TEAM_AVAILABILITY.inRegions
        )
      }
    )

    test('says "Runs in the UK or EU" when any one team SKU qualifies', () => {
      const skus = [
        { ...UK_TEAM_SKU, regions: ['eastus'] },
        { name: 'Other', tiers: ['team'], regions: ['uksouth'] }
      ]

      expect(teamAvailability(model({ skus }))).toBe(
        TEAM_AVAILABILITY.inRegions
      )
    })

    test('says "Not in the UK or EU yet" for a team SKU only in the US', () => {
      const skus = [{ ...UK_TEAM_SKU, regions: ['eastus'] }]

      expect(teamAvailability(model({ skus }))).toBe(
        TEAM_AVAILABILITY.notInRegions
      )
      expect(TEAM_AVAILABILITY.notInRegions).toBe('Not in the UK or EU yet')
    })

    test('says "Not in the UK or EU yet" when a team SKU mixes allowed and other regions', () => {
      const skus = [{ ...UK_TEAM_SKU, regions: ['uksouth', 'eastus'] }]

      expect(teamAvailability(model({ skus }))).toBe(
        TEAM_AVAILABILITY.notInRegions
      )
    })

    test('says "Not in the UK or EU yet" when a team SKU has no regions anywhere', () => {
      expect(teamAvailability(model({ regions: undefined }))).toBe(
        TEAM_AVAILABILITY.notInRegions
      )
      expect(teamAvailability(model({ regions: [] }))).toBe(
        TEAM_AVAILABILITY.notInRegions
      )
    })

    test('never counts a worldwide SKU, even in an allowed region', () => {
      const skus = [{ ...WORLDWIDE_SKU, regions: ['uksouth'] }]

      expect(teamAvailability(model({ skus }))).toBe(
        TEAM_AVAILABILITY.notInRegions
      )
    })

    test('counts a usable team SKU beside a worldwide one', () => {
      expect(
        teamAvailability(model({ skus: [WORLDWIDE_SKU, UK_TEAM_SKU] }))
      ).toBe(TEAM_AVAILABILITY.inRegions)
    })

    test.each([
      ['no SKUs', { skus: undefined }],
      ['an empty SKU list', { skus: [] }],
      ['only research SKUs', { skus: [RESEARCH_SKU] }],
      ['a SKU with no tiers', { skus: [{ name: 'Standard' }] }]
    ])('says "Not for teams yet" for %s', (_why, fields) => {
      expect(teamAvailability(model(fields))).toBe(
        TEAM_AVAILABILITY.notForTeams
      )
      expect(TEAM_AVAILABILITY.notForTeams).toBe('Not for teams yet')
    })
  })

  describe('isCapacityDuplicate', () => {
    test('is true for a slug ending -2 and false otherwise', () => {
      expect(isCapacityDuplicate(model({ slug: 'gpt-4o-2' }))).toBe(true)
      expect(isCapacityDuplicate(model({ slug: 'gpt-4o' }))).toBe(false)
      expect(isCapacityDuplicate(model({ slug: 'gpt-4o-mini' }))).toBe(false)
      expect(isCapacityDuplicate({})).toBe(false)
    })
  })

  describe('groupModels', () => {
    const embeddings = model({
      slug: 'text-embedding-3-large',
      eligible: false,
      eligibilityReason: 'Embeddings are not offered yet',
      tiers: []
    })

    test('leaves out capacity duplicates, even ineligible ones', () => {
      const { available, notAvailable } = groupModels([
        model(),
        model({ slug: 'gpt-4o-2' }),
        model({ slug: 'old-2', eligible: false })
      ])

      expect(available.map((item) => item.slug)).toEqual(['gpt-4o'])
      expect(notAvailable).toEqual([])
    })

    test('says whether each available model can be tried and what teams are told', () => {
      const nano = model({
        slug: 'gpt-4-1-nano',
        tiers: ['team'],
        skus: [{ ...UK_TEAM_SKU, regions: ['eastus'] }]
      })
      const worldwideOnly = model({
        slug: 'gpt-5-nano',
        skus: [{ ...WORLDWIDE_SKU, regions: ['uksouth'] }]
      })
      const { available } = groupModels([model(), nano, worldwideOnly])

      expect(
        available.map((item) => [item.slug, item.canTry, item.teamAvailability])
      ).toEqual([
        ['gpt-4o', true, 'Runs in the UK or EU'],
        ['gpt-4-1-nano', false, 'Not in the UK or EU yet'],
        ['gpt-5-nano', false, 'Not in the UK or EU yet']
      ])
    })

    test('puts ineligible models under not available with their reason', () => {
      const { available, notAvailable } = groupModels([model(), embeddings])

      expect(available).toHaveLength(1)
      expect(notAvailable).toEqual([
        { ...embeddings, reason: 'Embeddings are not offered yet' }
      ])
    })

    test('gives an ineligible model with no reason a plain one', () => {
      const { notAvailable } = groupModels([
        model({ eligible: false, eligibilityReason: undefined })
      ])

      expect(notAvailable[0].reason).toBe('Not approved yet')
    })

    test('copes with an empty list', () => {
      expect(groupModels([])).toEqual({ available: [], notAvailable: [] })
    })
  })

  describe('isEligible and unavailableReason', () => {
    test('a model is eligible unless the catalogue says it is not', () => {
      expect(isEligible(model())).toBe(true)
      expect(isEligible(model({ eligible: undefined }))).toBe(true)
      expect(isEligible(model({ eligible: false }))).toBe(false)
    })

    test('gives the catalogue reason, else Retired for a retired model, else a plain one', () => {
      expect(unavailableReason({ eligibilityReason: 'Not yet' })).toBe(
        'Not yet'
      )
      expect(unavailableReason({ lifecycle: { status: 'retired' } })).toBe(
        'Retired'
      )
      expect(unavailableReason({})).toBe('Not approved yet')
    })
  })

  describe('teamRegion', () => {
    test('is the region of a team SKU that runs in the UK or EU', () => {
      expect(teamRegion(model())).toBe('uksouth')
    })

    test('prefers the SKU’s own regions over the model’s', () => {
      const skus = [{ ...UK_TEAM_SKU, regions: ['swedencentral'] }]

      expect(teamRegion(model({ skus }))).toBe('swedencentral')
    })

    test('skips a team SKU that does not qualify and finds one that does', () => {
      const skus = [
        { ...UK_TEAM_SKU, regions: ['eastus'] },
        { ...WORLDWIDE_SKU, regions: ['uksouth'] },
        {
          name: 'Other',
          tiers: ['team'],
          regions: ['westeurope', 'northeurope']
        }
      ]

      expect(teamRegion(model({ skus }))).toBe('westeurope')
    })

    test.each([
      ['only in the US', { regions: ['eastus'] }],
      ['only a worldwide SKU', { skus: [WORLDWIDE_SKU] }],
      ['no team SKU', { skus: [RESEARCH_SKU] }],
      ['no SKUs', { skus: undefined }]
    ])('is undefined for a model with %s', (_why, fields) => {
      expect(teamRegion(model(fields))).toBeUndefined()
    })
  })

  describe('filterByShow', () => {
    const models = [
      { slug: 'a', canTry: true, teamAvailability: 'Runs in the UK or EU' },
      { slug: 'b', canTry: true, teamAvailability: 'Not for teams yet' },
      { slug: 'c', canTry: false, teamAvailability: 'Runs in the UK or EU' },
      { slug: 'd', canTry: true, teamAvailability: 'Not in the UK or EU yet' }
    ]
    const slugs = (list) => list.map((item) => item.slug)

    test('"all" keeps every model', () => {
      expect(slugs(filterByShow(models, 'all'))).toEqual(['a', 'b', 'c', 'd'])
    })

    test('"team" keeps the models that run in the UK or EU', () => {
      expect(slugs(filterByShow(models, 'team'))).toEqual(['a', 'c'])
    })

    test('"research" keeps the models that can be tried', () => {
      expect(slugs(filterByShow(models, 'research'))).toEqual(['a', 'b', 'd'])
    })

    test('names the three choices', () => {
      expect(SHOW_OPTIONS).toEqual({
        all: 'All models',
        team: 'Models you can add to a team',
        research: 'Models you can try on your own'
      })
    })
  })

  describe('use cases as words', () => {
    const useCases = [
      'Chat assistants',
      'Summarising documents',
      'Reading images'
    ]

    test('a list keeps the first as written and lowers the rest', () => {
      expect(useCasesList(useCases)).toBe(
        'Chat assistants, summarising documents, reading images'
      )
    })

    test('a sentence lowers all and ends with "and"', () => {
      expect(useCasesSentence(useCases)).toBe(
        'chat assistants, summarising documents and reading images'
      )
      expect(useCasesSentence(useCases.slice(0, 2))).toBe(
        'chat assistants and summarising documents'
      )
      expect(useCasesSentence(['Prototyping'])).toBe('prototyping')
    })

    test('keeps an acronym in capitals', () => {
      expect(useCasesList(['Chat', 'OCR of scans'])).toBe('Chat, OCR of scans')
      expect(useCasesSentence(['OCR of scans', 'Chat'])).toBe(
        'OCR of scans and chat'
      )
    })

    test('are empty when there are none', () => {
      expect(useCasesList([])).toBe('')
      expect(useCasesList(undefined)).toBe('')
      expect(useCasesSentence([])).toBe('')
      expect(useCasesSentence(undefined)).toBe('')
    })
  })
})

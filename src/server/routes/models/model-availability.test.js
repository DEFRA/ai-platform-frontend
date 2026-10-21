import {
  SHOW_OPTIONS,
  TEAM_AVAILABILITY,
  canTry,
  filterByShow,
  groupModels,
  isCapacityDuplicate,
  isEligible,
  teamAvailability,
  teamUkRegion,
  unavailableReason,
  useCasesList,
  useCasesSentence
} from './model-availability.js'

const UK_TEAM_SKU = { name: 'DataZoneStandard', tiers: ['team'] }

function model(fields = {}) {
  return {
    slug: 'gpt-4o',
    eligible: true,
    tiers: ['research', 'team'],
    regions: ['uksouth'],
    skus: [UK_TEAM_SKU],
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

    test.each([
      ['is not eligible', { eligible: false }],
      ['is not offered to research', { tiers: ['team'] }],
      ['has no tiers', { tiers: undefined }]
    ])('is false for a model that %s', (_why, fields) => {
      expect(canTry(model(fields))).toBe(false)
    })
  })

  describe('teamAvailability', () => {
    test('says "Runs in the UK" for a team SKU that takes the model’s UK regions', () => {
      expect(teamAvailability(model())).toBe(TEAM_AVAILABILITY.inUk)
      expect(TEAM_AVAILABILITY.inUk).toBe('Runs in the UK')
    })

    test('says "Runs in the UK" for a team SKU whose own regions are all in the UK, in any case', () => {
      const skus = [{ ...UK_TEAM_SKU, regions: ['UKSouth', 'ukwest'] }]

      expect(
        teamAvailability(model({ skus, regions: ['swedencentral'] }))
      ).toBe(TEAM_AVAILABILITY.inUk)
    })

    test('says "Runs in the UK" when any one team SKU is in the UK', () => {
      const skus = [
        { ...UK_TEAM_SKU, regions: ['swedencentral'] },
        { name: 'Other', tiers: ['team'], regions: ['uksouth'] }
      ]

      expect(teamAvailability(model({ skus }))).toBe(TEAM_AVAILABILITY.inUk)
    })

    test('says "Not in the UK yet" for a team SKU only outside the UK (GPT-4.1 nano)', () => {
      const skus = [{ ...UK_TEAM_SKU, regions: ['swedencentral'] }]

      expect(teamAvailability(model({ skus }))).toBe(TEAM_AVAILABILITY.notInUk)
      expect(TEAM_AVAILABILITY.notInUk).toBe('Not in the UK yet')
    })

    test('says "Not in the UK yet" when a team SKU mixes UK and other regions', () => {
      const skus = [{ ...UK_TEAM_SKU, regions: ['uksouth', 'swedencentral'] }]

      expect(teamAvailability(model({ skus }))).toBe(TEAM_AVAILABILITY.notInUk)
    })

    test('says "Not in the UK yet" when a team SKU has no regions anywhere', () => {
      expect(teamAvailability(model({ regions: undefined }))).toBe(
        TEAM_AVAILABILITY.notInUk
      )
      expect(teamAvailability(model({ regions: [] }))).toBe(
        TEAM_AVAILABILITY.notInUk
      )
    })

    test.each([
      ['no SKUs', { skus: undefined }],
      ['an empty SKU list', { skus: [] }],
      [
        'only research SKUs',
        { skus: [{ name: 'GlobalStandard', tiers: ['research'] }] }
      ],
      ['a SKU with no tiers', { skus: [{ name: 'GlobalStandard' }] }]
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
        skus: [{ ...UK_TEAM_SKU, regions: ['swedencentral'] }]
      })
      const { available } = groupModels([model(), nano])

      expect(
        available.map((item) => [item.slug, item.canTry, item.teamAvailability])
      ).toEqual([
        ['gpt-4o', true, 'Runs in the UK'],
        ['gpt-4-1-nano', false, 'Not in the UK yet']
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

  describe('teamUkRegion', () => {
    test('is the region of a team SKU that runs in the UK', () => {
      expect(teamUkRegion(model())).toBe('uksouth')
    })

    test('prefers the SKU’s own regions over the model’s', () => {
      const skus = [{ ...UK_TEAM_SKU, regions: ['ukwest'] }]

      expect(teamUkRegion(model({ skus }))).toBe('ukwest')
    })

    test('skips a team SKU outside the UK and finds one in it', () => {
      const skus = [
        { ...UK_TEAM_SKU, regions: ['swedencentral'] },
        { name: 'Other', tiers: ['team'], regions: ['uksouth'] }
      ]

      expect(teamUkRegion(model({ skus }))).toBe('uksouth')
    })

    test.each([
      ['only outside the UK', { regions: ['swedencentral'] }],
      ['no team SKU', { skus: [{ name: 'X', tiers: ['research'] }] }],
      ['no SKUs', { skus: undefined }]
    ])('is undefined for %s', (_why, fields) => {
      expect(teamUkRegion(model(fields))).toBeUndefined()
    })
  })

  describe('filterByShow', () => {
    const models = [
      { slug: 'a', canTry: true, teamAvailability: 'Runs in the UK' },
      { slug: 'b', canTry: true, teamAvailability: 'Not for teams yet' },
      { slug: 'c', canTry: false, teamAvailability: 'Runs in the UK' },
      { slug: 'd', canTry: true, teamAvailability: 'Not in the UK yet' }
    ]
    const slugs = (list) => list.map((item) => item.slug)

    test('"all" keeps every model', () => {
      expect(slugs(filterByShow(models, 'all'))).toEqual(['a', 'b', 'c', 'd'])
    })

    test('"team" keeps the models that run in the UK', () => {
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

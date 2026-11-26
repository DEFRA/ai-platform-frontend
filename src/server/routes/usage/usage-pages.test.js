import {
  attentionOf,
  carbonViewOf,
  costsCsvOf,
  costsViewOf,
  homeUsageOf,
  overviewViewOf
} from './usage-pages.js'

const totals = {
  requests: 10,
  promptTokens: 6_000_000,
  completionTokens: 4_000_000,
  tokens: 10_000_000,
  cost: 40,
  carbonKg: 8,
  electricityKwh: 20,
  costPerMillionTokens: 4,
  carbonGramsPerMillionTokens: 800
}

function overview(current = {}, overrides = {}) {
  return {
    teamName: 'Flood Risk Team',
    teamSlug: 'flood-risk-team',
    source: 'log-analytics',
    costBasis: { currency: 'USD', priceVersion: 'v1' },
    carbonBasis: { enabled: true },
    month: { key: '2026-11', daysElapsed: 10, daysInMonth: 30 },
    months: [
      { key: '2026-10', cost: 30, carbonKg: 6 },
      { key: '2026-11', cost: 40, carbonKg: 8 }
    ],
    current: {
      totals,
      forecast: { tokens: 30_000_000, cost: 120, carbonKg: 24 },
      byEnvironment: [
        { environment: 'infradev', tokens: 10_000_000, share: 1, cost: 40 }
      ],
      byModel: [
        {
          modelSlug: 'gpt-4o',
          requests: 10,
          promptTokens: 6_000_000,
          completionTokens: 4_000_000,
          tokens: 10_000_000,
          share: 1,
          price: { inputPerMillion: 2.5, outputPerMillion: 10 },
          cost: 40,
          carbonKg: 8
        }
      ],
      byDay: [{ day: '2026-11-01', tokens: 10_000_000, byEnvironment: {} }],
      ...current
    },
    unavailable: [],
    unpricedModels: [],
    attention: [],
    ...overrides
  }
}

describe('#attentionOf', () => {
  test('says one call, not calls, and links to that environment’s page', () => {
    expect(
      attentionOf({ environment: 'qa', count: 1, days: 7 }, 'a-team')
    ).toEqual({
      text: 'QA had 1 call refused in the last 7 days, because it went over the limit.',
      href: '/environments/a-team/qa',
      linkText: 'View QA'
    })
  })
})

describe('#costsViewOf', () => {
  test('has no forecast bar and says not available when nothing can be priced', () => {
    const view = costsViewOf(
      overview({
        totals: { ...totals, cost: null, costPerMillionTokens: null },
        forecast: { tokens: 0, cost: null, carbonKg: null },
        byModel: [
          {
            modelSlug: 'mystery',
            requests: 1,
            promptTokens: 1,
            completionTokens: 1,
            tokens: 2,
            share: 1,
            price: null,
            cost: null,
            carbonKg: null
          }
        ]
      })
    )

    expect(view.cards.map(({ value }) => value)).toEqual([
      'Not available',
      'Not available',
      'Not available'
    ])
    expect(view.byModel[0]).toMatchObject({
      price: 'No price yet',
      cost: 'Not available',
      share: 'Not available',
      value: 0
    })
  })

  test('shares the cost between environments and models', () => {
    const view = costsViewOf(overview())

    expect(view.byEnvironment[0].share).toBe('100%')
    expect(view.byModel[0].price).toBe('US$2.50 and US$10.00')
    expect(view.hasUsage).toBe(true)
  })
})

describe('#carbonViewOf', () => {
  test('shows the figures when every model has a factor', () => {
    const view = carbonViewOf(overview())

    expect(view.cards[3].value).toBe('800 g')
    expect(view.byModel[0].carbonShare).toBe('100%')
  })

  test('says not available, and shares nothing, when a model has no factor', () => {
    const view = carbonViewOf(
      overview({
        totals: {
          ...totals,
          carbonKg: null,
          electricityKwh: null,
          carbonGramsPerMillionTokens: null
        },
        forecast: { tokens: 0, cost: 0, carbonKg: null },
        byModel: [
          {
            modelSlug: 'mystery',
            tokens: 5,
            share: 1,
            carbonKg: null
          }
        ]
      })
    )

    expect(view.cards[3].value).toBe('Not available')
    expect(view.byModel[0]).toMatchObject({
      carbonShare: 'Not available',
      value: 0
    })
    expect(view.carbonDonut).toBeNull()
  })
})

describe('#overviewViewOf', () => {
  test('leaves out the forecast note and the carbon card when they are not there', () => {
    const view = overviewViewOf(
      overview(
        { forecast: { tokens: 0, cost: null, carbonKg: null } },
        { carbonBasis: { enabled: false } }
      )
    )

    expect(view.cards.map(({ label }) => label)).toEqual([
      'Tokens used',
      'Estimated cost',
      'Requests'
    ])
    expect(view.cards[1].note).toBeNull()
  })

  test('has a carbon card with its forecast when carbon is on', () => {
    const view = overviewViewOf(overview())

    expect(view.cards[3].label).toBe('Carbon (CO₂e), estimated')
    expect(view.cards[3].note).toContain('Forecast')
  })

  test('has a carbon card without a forecast when it has none', () => {
    const view = overviewViewOf(
      overview({ forecast: { tokens: 0, cost: 0, carbonKg: null } })
    )

    expect(view.cards[3].note).toBeNull()
  })
})

describe('#costsCsvOf', () => {
  test('quotes a cell a spreadsheet would read as a formula, and a comma', () => {
    const csv = costsCsvOf(
      overview({
        byModel: [
          {
            modelSlug: '=SUM(A1)',
            requests: 1,
            promptTokens: 2,
            completionTokens: 3,
            cost: null
          },
          {
            modelSlug: 'a,b',
            requests: 1,
            promptTokens: 2,
            completionTokens: 3,
            cost: 1.5
          }
        ]
      })
    )

    expect(csv.split('\r\n')).toEqual([
      'Month,Model,Requests,Input tokens,Output tokens,Estimated cost (USD)',
      "2026-11,'=SUM(A1),1,2,3,",
      '2026-11,"a,b",1,2,3,1.50',
      ''
    ])
  })
})

describe('#homeUsageOf', () => {
  function item(overrides = {}) {
    return {
      slug: 'flood-risk-team',
      name: 'Flood Risk Team',
      available: true,
      source: 'log-analytics',
      month: { key: '2026-11', daysElapsed: 10, daysInMonth: 30 },
      costBasis: { currency: 'USD' },
      carbonBasis: { enabled: true },
      totals: { tokens: 10_000_000, cost: 40, carbonKg: 8 },
      forecast: { tokens: 30_000_000, cost: 120, carbonKg: 24 },
      attention: [],
      ...overrides
    }
  }

  test('is null when the person is in no team', () => {
    expect(homeUsageOf({ items: [] })).toBeNull()
  })

  test('has cards for one team, with the carbon card when carbon is on', () => {
    const usage = homeUsageOf({ items: [item()] })

    expect(usage.cards.map(({ label }) => label)).toEqual([
      'Tokens used',
      'Estimated cost',
      'Carbon (CO₂e), estimated'
    ])
    expect(usage.link).toEqual({
      href: '/usage/flood-risk-team',
      text: 'View usage for Flood Risk Team'
    })
  })

  test('has no forecast notes when there is no forecast, and no carbon card when it is off', () => {
    const usage = homeUsageOf({
      items: [
        item({
          carbonBasis: { enabled: false },
          forecast: { tokens: 0, cost: null, carbonKg: null }
        })
      ]
    })

    expect(usage.cards).toHaveLength(2)
    expect(usage.cards[1].note).toBeNull()
  })

  test('has no forecast note on the carbon card when there is none', () => {
    const usage = homeUsageOf({
      items: [item({ forecast: { tokens: 0, cost: 0, carbonKg: null } })]
    })

    expect(usage.cards[2].note).toBeNull()
  })

  test('has a box for each team that can be read, busiest first, and none for one it cannot', () => {
    const usage = homeUsageOf({
      items: [
        item(),
        item({
          slug: 'b-team',
          name: 'B Team',
          totals: { tokens: 20_000_000, cost: 80, carbonKg: 1 }
        }),
        item({ slug: 'c-team', name: 'C Team', available: false })
      ]
    })

    expect(usage.cards.map(({ label }) => label)).toEqual([
      'B Team',
      'Flood Risk Team'
    ])
    expect(usage.cards[0]).toEqual({
      value: '20.0m',
      label: 'B Team',
      href: '/usage/b-team',
      note: 'Estimated cost US$80.00, forecast US$120'
    })
    expect(usage.link).toEqual({
      href: '/usage',
      text: 'View usage for all your teams'
    })
    expect(usage.unavailable).toEqual(['C Team'])
  })

  test('keeps four boxes, the busiest, and breaks a tie by name', () => {
    const items = ['e', 'd', 'c', 'b', 'a'].map((slug) =>
      item({ slug: `${slug}-team`, name: slug.toUpperCase() })
    )

    const usage = homeUsageOf({ items })

    expect(usage.cards.map(({ label }) => label)).toEqual(['A', 'B', 'C', 'D'])
    expect(usage.intro).toContain('The four teams that have used the most')
  })

  test('says the cost is not available, and gives no forecast, for a team with no price', () => {
    const usage = homeUsageOf({
      items: [
        item(),
        item({
          slug: 'b-team',
          name: 'B Team',
          totals: { tokens: 1, cost: null, carbonKg: null },
          forecast: { tokens: 1, cost: null, carbonKg: null }
        })
      ]
    })

    expect(usage.cards[1].note).toBe('Estimated cost Not available')
  })

  test('has no month when no team can be read', () => {
    const usage = homeUsageOf({ items: [item({ available: false })] })

    expect(usage.monthName).toBeNull()
    expect(usage.unavailable).toEqual(['Flood Risk Team'])
  })
})

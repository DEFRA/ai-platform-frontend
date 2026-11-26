import { keyUsageOf, keyUsageRowOf } from './key-usage-view.js'

const row = {
  _id: 'cred-1',
  modelDisplayName: 'GPT-4o',
  modelSlug: 'gpt-4o',
  expiresAt: '2026-10-26T00:00:00.000Z',
  renewalCount: 1
}
const limits = { tokensPerDay: 100_000, requestsPerMinute: 60 }

function usage(overrides = {}) {
  return {
    source: 'log-analytics',
    totals: { requests: 3, totalTokens: 211_400 },
    byDay: [
      { day: '2026-10-20', totalTokens: 50_000 },
      { day: '2026-10-21', totalTokens: 100_000 },
      { day: '2026-10-22', totalTokens: 61_400 }
    ],
    key: {
      expiresAt: '2026-10-26T00:00:00.000Z',
      renewalsUsed: 1,
      renewalCap: 3,
      validDays: 7
    },
    ...overrides
  }
}

describe('#keyUsageRowOf', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-10-22T12:00:00Z')
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('sets today against the tokens a day, with the share and a status', () => {
    const { tokensRow } = keyUsageRowOf(row, usage(), limits, 7)

    expect(tokensRow).toMatchObject({
      figure: '100,000',
      usedToday: '61,400',
      usedShare: '61%',
      status: { text: 'Within limit', colour: 'green' }
    })
    expect(tokensRow.bar).toContain('<svg')
  })

  test.each([
    [80_000, 'Near the limit', 'orange'],
    [99_999, 'Near the limit', 'orange'],
    [100_000, 'Limit reached', 'red'],
    [150_000, 'Limit reached', 'red']
  ])('calls %i tokens today %s', (tokens, text, colour) => {
    const reading = usage({
      byDay: [{ day: '2026-10-22', totalTokens: tokens }]
    })

    expect(
      keyUsageRowOf(row, reading, limits, 7).tokensRow.status
    ).toMatchObject({ text, colour })
  })

  test('shows the calls a minute the model allows, and says it is not measured', () => {
    expect(keyUsageRowOf(row, usage(), limits, 7).requestsRow).toEqual({
      figure: '60'
    })
    expect(
      keyUsageRowOf(row, usage(), { tokensPerDay: 5 }, 7).requestsRow
    ).toBeNull()
  })

  test('says how many days the key has left, and how often it was renewed', () => {
    expect(keyUsageRowOf(row, usage(), limits, 7).keyRow).toMatchObject({
      figure: '4 days left',
      note: 'A key works for 7 days. Renewed 1 of 3 times.'
    })
  })

  test.each([
    ['2026-10-23T00:00:00.000Z', '1 day left'],
    ['2026-10-22T20:00:00.000Z', 'Ends today'],
    ['2026-10-01T00:00:00.000Z', 'Ends today']
  ])('says a key that ends %s has %s', (expiresAt, figure) => {
    const reading = usage({ key: { ...usage().key, expiresAt } })

    expect(keyUsageRowOf(row, reading, limits, 7).keyRow.figure).toBe(figure)
  })

  test('draws the tokens each day against the allowance, with a legend and a table', () => {
    const view = keyUsageRowOf(row, usage(), limits, 7)

    expect(view.chart).toContain('app-chart__marker')
    expect(view.chart).toContain('Your allowance, 100,000 a day')
    expect(view.legend.map(({ text }) => text)).toEqual([
      'Under 80% of your allowance',
      '80% or more',
      'All of it'
    ])
    expect(view.table).toEqual([
      { label: '20 Oct', tokens: '50,000', share: '50%' },
      { label: '21 Oct', tokens: '100,000', share: '100%' },
      { label: '22 Oct', tokens: '61,400', share: '61%' }
    ])
  })

  test('says the day the allowance was used up, and that the period used what', () => {
    const view = keyUsageRowOf(row, usage(), limits, 7)

    expect(view.reachedText).toBe(
      'Your key used all of its allowance on 21 October.'
    )
    expect(view.totalText).toBe(
      'Used in the last 7 days: 211k tokens in 3 requests.'
    )
  })

  test('says nothing of reaching the allowance when no day did', () => {
    const reading = usage({ byDay: [{ day: '2026-10-22', totalTokens: 10 }] })

    expect(keyUsageRowOf(row, reading, limits, 7).reachedText).toBeNull()
  })

  test('has no allowance row, marker or legend when the model has no default', () => {
    const view = keyUsageRowOf(row, usage(), {}, 7)

    expect(view.tokensRow).toBeNull()
    expect(view.chart).not.toContain('app-chart__marker')
    expect(view.legend).toEqual([])
    expect(view.table[0].share).toBeNull()
  })

  test('is a zero today, not an error, when there was no use', () => {
    const reading = usage({ byDay: [] })

    expect(keyUsageRowOf(row, reading, limits, 7).tokensRow).toMatchObject({
      usedToday: '0',
      usedShare: '0%'
    })
  })

  test('still shows the limits and the key’s time when there is no reading', () => {
    const view = keyUsageRowOf(row, null, limits, 7)

    expect(view.available).toBe(false)
    expect(view.tokensRow).toMatchObject({
      figure: '100,000',
      bar: null,
      status: null
    })
    expect(view.requestsRow).toEqual({ figure: '60' })
    expect(view.keyRow.figure).toBe('4 days left')
    expect(view.chart).toBeUndefined()
  })

  test('has no key row for a key with no end', () => {
    expect(
      keyUsageRowOf({ ...row, expiresAt: undefined }, null, limits, 7).keyRow
    ).toBeNull()
  })

  test('flags example figures', () => {
    expect(
      keyUsageRowOf(row, usage({ source: 'mock' }), limits, 7).isMock
    ).toBe(true)
  })
})

describe('#keyUsageOf', () => {
  test('has no rows, and says why, when there is no working key', () => {
    expect(keyUsageOf([], [], {})).toMatchObject({
      rows: [],
      empty: { text: expect.stringContaining('do not have a key yet') }
    })
    expect(keyUsageOf([{ ...row, expired: true }], [null], {})).toMatchObject({
      rows: [],
      empty: { text: expect.stringContaining('has expired') }
    })
  })

  test('is a row for each working key, in order, with the limits of its model', () => {
    const result = keyUsageOf(
      [
        row,
        { ...row, _id: 'cred-2', expired: true },
        { ...row, _id: 'cred-3', modelSlug: 'other' }
      ],
      [usage({ source: 'mock' }), null, usage()],
      { 'gpt-4o': limits }
    )

    expect(result.days).toBe(7)
    expect(result.isMock).toBe(true)
    expect(result.many).toBe(true)
    expect(result.rows.map(({ id }) => id)).toEqual(['cred-1', 'cred-3'])
    expect(result.rows[1].tokensRow).toBeNull()
  })

  test('is not many for a single key', () => {
    expect(keyUsageOf([row], [usage()], { 'gpt-4o': limits }).many).toBe(false)
  })
})

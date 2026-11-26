import { keyUsageOf, keyUsageRowOf } from './key-usage-view.js'

const row = { _id: 'cred-1', modelDisplayName: 'GPT-4o', modelSlug: 'gpt-4o' }

function usage(overrides = {}) {
  return {
    source: 'log-analytics',
    totals: { requests: 3, totalTokens: 1500 },
    byDay: [
      { day: '2026-10-20', totalTokens: 500 },
      { day: '2026-10-21', totalTokens: 1000 }
    ],
    ...overrides
  }
}

describe('#keyUsageRowOf', () => {
  test('sets the busiest day against the default allowance', () => {
    expect(keyUsageRowOf(row, usage(), 2000)).toMatchObject({
      available: true,
      requests: '3',
      peakText: '1,000',
      peakShare: 0.5,
      allowanceText: '2,000'
    })
  })

  test('caps the share at 1 when a day went over the allowance', () => {
    expect(keyUsageRowOf(row, usage(), 400).peakShare).toBe(1)
  })

  test('has no share, and no allowance text, when the model has no default', () => {
    expect(keyUsageRowOf(row, usage(), undefined)).toMatchObject({
      peakShare: null,
      allowanceText: null
    })
  })

  test('is a zero peak, not an error, when there was no use', () => {
    expect(keyUsageRowOf(row, usage({ byDay: [] }), 1000)).toMatchObject({
      peakText: '0',
      peakShare: 0
    })
  })

  test('says it is unavailable when there is no reading', () => {
    expect(keyUsageRowOf(row, null, 1000)).toEqual({
      id: 'cred-1',
      modelDisplayName: 'GPT-4o',
      allowanceText: '1,000',
      available: false
    })
  })
})

describe('#keyUsageOf', () => {
  test('is null when there is no working key', () => {
    expect(keyUsageOf([], [], {})).toBeNull()
    expect(keyUsageOf([{ ...row, expired: true }], [null], {})).toBeNull()
  })

  test('is a row for each working key, in order, and flags example figures', () => {
    const result = keyUsageOf(
      [
        row,
        { ...row, _id: 'cred-2', expired: true },
        { ...row, _id: 'cred-3' }
      ],
      [usage({ source: 'mock' }), null, usage()],
      { 'gpt-4o': 1000 }
    )

    expect(result.days).toBe(7)
    expect(result.isMock).toBe(true)
    expect(result.rows.map(({ id }) => id)).toEqual(['cred-1', 'cred-3'])
  })
})

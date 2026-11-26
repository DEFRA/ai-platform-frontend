import {
  formatCost,
  formatCount,
  formatDay,
  periodText,
  usageDaysOf
} from './usage-format.js'

describe('#usageDaysOf', () => {
  test.each([
    ['7', 7],
    [30, 30],
    ['90', 90]
  ])('takes %j as %i', (value, days) => {
    expect(usageDaysOf(value)).toBe(days)
  })

  test.each([undefined, '', '5', 'abc', '30; drop', '-7', '7.5', null, []])(
    'falls back to 30 for %j',
    (value) => {
      expect(usageDaysOf(value)).toBe(30)
    }
  )
})

describe('#formatCount', () => {
  test('puts thousands separators in a whole number', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
    expect(formatCount(0)).toBe('0')
  })
})

describe('#formatCost', () => {
  test('writes pounds or dollars from the currency code', () => {
    expect(formatCost(3.5, 'USD')).toBe('US$3.50')
    expect(formatCost(1234.5, 'GBP')).toBe('£1,234.50')
  })

  test('says "Not available" for no cost, and never zero for it', () => {
    expect(formatCost(null, 'USD')).toBe('Not available')
    expect(formatCost(undefined, 'USD')).toBe('Not available')
  })

  test('keeps a real zero as a cost', () => {
    expect(formatCost(0, 'USD')).toBe('US$0.00')
  })
})

describe('#periodText', () => {
  test('names the first and the last day, the end being exclusive', () => {
    expect(periodText({ from: '2026-11-20', to: '2026-11-27' })).toBe(
      '20 November 2026 to 26 November 2026'
    )
  })

  test('crosses a year', () => {
    expect(periodText({ from: '2026-12-04', to: '2027-01-03' })).toBe(
      '4 December 2026 to 2 January 2027'
    )
  })
})

describe('#formatDay', () => {
  test('is a short UTC day', () => {
    expect(formatDay('2026-11-02')).toBe('2 Nov')
  })
})

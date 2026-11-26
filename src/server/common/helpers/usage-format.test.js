import {
  formatCost,
  formatCount,
  formatCarbon,
  formatDay,
  formatElectricity,
  formatMonth,
  formatMonthLong,
  formatPercent,
  formatTokens,
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

describe('#formatTokens', () => {
  test.each([
    [0, '0'],
    [999, '999'],
    [12_345, '12.3k'],
    [439_100_000, '439m'],
    [43_910_000, '43.9m'],
    [1_200_000, '1.2m'],
    [2_270_000_000, '2.27bn']
  ])('writes %d as %s', (value, expected) => {
    expect(formatTokens(value)).toBe(expected)
  })
})

describe('#formatCarbon', () => {
  test('is kilograms from a kilogram, and grams below it', () => {
    expect(formatCarbon(11.7)).toBe('11.7 kg')
    expect(formatCarbon(0.027)).toBe('27 g')
    expect(formatCarbon(0.0042)).toBe('4.2 g')
  })

  test('says "Not available" for no figure, and keeps a real zero', () => {
    expect(formatCarbon(null)).toBe('Not available')
    expect(formatCarbon(0)).toBe('0.0 g')
  })
})

describe('#formatElectricity', () => {
  test('is kilowatt hours, or "Not available"', () => {
    expect(formatElectricity(58.4)).toBe('58 kWh')
    expect(formatElectricity(2.34)).toBe('2.3 kWh')
    expect(formatElectricity(null)).toBe('Not available')
  })
})

describe('#formatPercent', () => {
  test('is a whole percentage', () => {
    expect(formatPercent(0.4149)).toBe('41%')
    expect(formatPercent(1)).toBe('100%')
  })
})

describe('#formatMonth and #formatMonthLong', () => {
  test('name the month of a key', () => {
    expect(formatMonth('2026-11')).toBe('Nov')
    expect(formatMonthLong('2026-11')).toBe('November 2026')
  })
})

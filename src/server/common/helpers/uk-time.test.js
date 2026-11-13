import {
  endOfUkDay,
  formatUkDate,
  formatUkDateTime,
  formatUkTime,
  startOfUkDay
} from './uk-time.js'

describe('#startOfUkDay and #endOfUkDay', () => {
  test.each([
    // [day, month, year, start, end]
    [28, 3, 2026, '2026-03-28T00:00:00.000Z', '2026-03-28T23:59:59.999Z'],
    // The clocks go forward at 01:00 on 29 March: midnight is still GMT, the
    // end of the day is BST.
    [29, 3, 2026, '2026-03-29T00:00:00.000Z', '2026-03-29T22:59:59.999Z'],
    [15, 7, 2026, '2026-07-14T23:00:00.000Z', '2026-07-15T22:59:59.999Z'],
    // The clocks go back at 02:00 BST on 25 October: midnight is still BST,
    // the end of the day is GMT.
    [25, 10, 2026, '2026-10-24T23:00:00.000Z', '2026-10-25T23:59:59.999Z'],
    [30, 10, 2026, '2026-10-30T00:00:00.000Z', '2026-10-30T23:59:59.999Z']
  ])(
    'Should turn %i/%i/%i into the UK day’s first and last instants',
    (day, month, year, start, end) => {
      expect(startOfUkDay({ day, month, year })).toBe(start)
      expect(endOfUkDay({ day, month, year })).toBe(end)
    }
  )
})

describe('UK time display', () => {
  test('Should show a winter (GMT) event as it is in UTC', () => {
    expect(formatUkDate('2026-10-30T14:05:00.000Z')).toBe('30 October 2026')
    expect(formatUkTime('2026-10-30T14:05:00.000Z')).toBe('2:05pm')
  })

  test('Should show a summer (BST) event an hour on', () => {
    expect(formatUkTime('2026-07-15T13:05:00.000Z')).toBe('2:05pm')
    expect(formatUkDate('2026-07-15T23:30:00.000Z')).toBe('16 July 2026')
    expect(formatUkTime('2026-07-15T23:30:00.000Z')).toBe('12:30am')
  })

  test('Should say midday and midnight in the same way as other times', () => {
    expect(formatUkTime('2026-01-10T12:00:00.000Z')).toBe('12:00pm')
    expect(formatUkTime('2026-01-10T00:09:00.000Z')).toBe('12:09am')
  })

  test('Should give the date and time together', () => {
    expect(formatUkDateTime('2026-07-15T13:05:00.000Z')).toBe(
      '15 July 2026, 2:05pm'
    )
  })
})

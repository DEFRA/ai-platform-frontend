import { MAX_REASON_LENGTH, readReason } from './credential-reason.js'

describe('#readReason', () => {
  test('is the reason, trimmed', () => {
    expect(readReason('  Suspected misuse  ')).toEqual({
      reason: 'Suspected misuse',
      text: '  Suspected misuse  '
    })
  })

  test('counts a new line once, as the page’s counter does, and sends it as one', () => {
    expect(readReason('one\r\ntwo')).toMatchObject({ reason: 'one\ntwo' })
    expect(
      readReason(`${'a'.repeat(249)}\r\n${'b'.repeat(250)}`).error
    ).toBeUndefined()
  })

  test.each([[undefined], [''], ['   '], ['\r\n\t'], [['a', 'b']], [{}]])(
    'asks for a reason when it is %j',
    (value) => {
      expect(readReason(value).error).toBe('Enter a reason')
    }
  )

  test('allows exactly 500 characters', () => {
    expect(readReason('a'.repeat(MAX_REASON_LENGTH)).error).toBeUndefined()
  })

  test('says it is too long at 501 characters, and keeps what was typed to show again', () => {
    const text = 'a'.repeat(MAX_REASON_LENGTH + 1)

    expect(readReason(text)).toEqual({
      error: 'Reason must be 500 characters or fewer',
      text
    })
  })

  test('keeps a non-text value as nothing to show again', () => {
    expect(readReason(['a', 'b']).text).toBe('')
  })
})

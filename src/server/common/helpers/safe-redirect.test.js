import { safeReturnTo } from './safe-redirect.js'

describe('#safeReturnTo', () => {
  test('keeps a same-origin path', () => {
    expect(safeReturnTo('/connect/team/select')).toBe('/connect/team/select')
  })

  test('keeps the query string and fragment', () => {
    expect(safeReturnTo('/models?tier=team#top')).toBe('/models?tier=team#top')
  })

  test.each([
    ['an absolute URL', 'https://attacker.example'],
    ['a protocol-relative URL', '//attacker.example'],
    ['a backslash-escaped URL', '/\\attacker.example'],
    [
      'dot segments that leave a protocol-relative path',
      '/.//attacker.example'
    ],
    [
      'a parent segment that leaves a protocol-relative path',
      '/a/..//attacker.example'
    ],
    [
      'an encoded dot segment that leaves a protocol-relative path',
      '/%2e//attacker.example'
    ],
    ['dot segments ending in a backslash path', '/.//\\attacker.example'],
    ['a protocol-relative path with a query', '/.//attacker.example?next=/'],
    ['a javascript scheme', 'javascript:alert(1)'],
    ['a path-less relative value', 'attacker.example'],
    ['an empty string', ''],
    ['undefined', undefined]
  ])('falls back for %s', (_label, value) => {
    expect(safeReturnTo(value, '/manage')).toBe('/manage')
  })

  test('keeps a path that merely has a double slash after the first segment', () => {
    expect(safeReturnTo('/models//x')).toBe('/models//x')
  })

  test('defaults the fallback to the root path', () => {
    expect(safeReturnTo('https://attacker.example')).toBe('/')
  })
})

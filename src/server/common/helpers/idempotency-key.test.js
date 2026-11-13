import { derivedIdempotencyKey } from './idempotency-key.js'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('#derivedIdempotencyKey', () => {
  test('is a version 4 UUID, the shape the backend takes', () => {
    expect(derivedIdempotencyKey(['kind', 'session', 'team'])).toMatch(UUID_V4)
  })

  test('is the same for the same parts, so a retry sends the same key', () => {
    expect(derivedIdempotencyKey(['kind', 'a', 1])).toBe(
      derivedIdempotencyKey(['kind', 'a', 1])
    )
  })

  test('is another for other parts, and for another kind of operation', () => {
    const keys = new Set([
      derivedIdempotencyKey(['kind', 'a']),
      derivedIdempotencyKey(['kind', 'b']),
      derivedIdempotencyKey(['other', 'a']),
      derivedIdempotencyKey(['kind', 'a', 'b'])
    ])

    expect(keys.size).toBe(4)
  })
})

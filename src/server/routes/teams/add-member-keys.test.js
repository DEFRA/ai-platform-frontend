import {
  carryAddKey,
  issueAddKey,
  keyForAdd,
  KEY_LIFETIME_MS,
  MAX_KEYS,
  voidAddKey
} from './add-member-keys.js'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OID = '0b8f6f4e-3c0f-4c46-9c58-2d3a8d2f1a11'
const OTHER_OID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const TEAM = 'flood-risk-team'
const NOW = 1_000_000

// A request with only the session a key is kept in.
function aRequest() {
  const store = new Map()

  return {
    store,
    yar: {
      get: (name) => store.get(name),
      set: (name, v) => store.set(name, v)
    }
  }
}

describe('#add-member-keys', () => {
  let request

  beforeEach(() => {
    request = aRequest()
  })

  describe('issuing a key when the form is shown', () => {
    test('issues a new key for each form, so two tabs never share one', () => {
      const first = issueAddKey(request, TEAM, NOW)
      const second = issueAddKey(request, TEAM, NOW)

      expect(first).toMatch(UUID)
      expect(second).toMatch(UUID)
      expect(second).not.toBe(first)
    })

    test('keeps no more than the most recent keys, dropping the oldest', () => {
      const keys = Array.from({ length: MAX_KEYS + 3 }, () =>
        issueAddKey(request, TEAM, NOW)
      )
      const kept = request.store.get('addMemberKeys').map(({ key }) => key)

      expect(kept).toHaveLength(MAX_KEYS)
      expect(kept).toEqual(keys.slice(-MAX_KEYS))
    })

    test('forgets a key once it has expired', () => {
      const key = issueAddKey(request, TEAM, NOW)

      const later = NOW + KEY_LIFETIME_MS
      const used = keyForAdd(
        request,
        TEAM,
        { oid: OID, role: 'user' },
        key,
        later
      )

      expect(used).not.toBe(key)
      expect(
        request.store.get('addMemberKeys').map((e) => e.key)
      ).not.toContain(key)
    })
  })

  describe('carrying the key a form came with', () => {
    test('carries a key this session issued for this team', () => {
      const key = issueAddKey(request, TEAM, NOW)

      expect(carryAddKey(request, TEAM, key, NOW)).toBe(key)
    })

    test.each([
      ['no key', undefined],
      ['an empty key', ''],
      [
        'a key this session never issued',
        '2f6a8e0c-9d2b-4a3e-8b57-6a1c0f3d9e11'
      ]
    ])('issues a new key for %s', (_name, offered) => {
      const key = carryAddKey(request, TEAM, offered, NOW)

      expect(key).toMatch(UUID)
      expect(key).not.toBe(offered)
    })

    test('issues a new key for a key that was issued for another team', () => {
      const key = issueAddKey(request, 'other-team', NOW)

      expect(carryAddKey(request, TEAM, key, NOW)).not.toBe(key)
    })
  })

  describe('the key for adding a person with a role', () => {
    const person = { oid: OID, role: 'user' }

    test('uses the key of the form, and the same key for a retry of the same person and role', () => {
      const key = issueAddKey(request, TEAM, NOW)

      expect(keyForAdd(request, TEAM, person, key, NOW)).toBe(key)
      expect(keyForAdd(request, TEAM, person, key, NOW)).toBe(key)
    })

    test('treats the same oid in another case as the same person', () => {
      const key = issueAddKey(request, TEAM, NOW)

      keyForAdd(request, TEAM, person, key, NOW)

      expect(
        keyForAdd(
          request,
          TEAM,
          { oid: OID.toUpperCase(), role: 'user' },
          key,
          NOW
        )
      ).toBe(key)
    })

    test('never reuses a key for another person or another role', () => {
      const key = issueAddKey(request, TEAM, NOW)
      const a = keyForAdd(request, TEAM, person, key, NOW)
      const b = keyForAdd(
        request,
        TEAM,
        { oid: OTHER_OID, role: 'user' },
        key,
        NOW
      )
      const bAdmin = keyForAdd(
        request,
        TEAM,
        { oid: OTHER_OID, role: 'admin' },
        key,
        NOW
      )

      expect(new Set([a, b, bAdmin]).size).toBe(3)
      expect(a).toBe(key)
    })

    test('replays the first choice when the admin goes back to it (A, B, then A again)', () => {
      const key = issueAddKey(request, TEAM, NOW)
      const a = keyForAdd(request, TEAM, person, key, NOW)

      keyForAdd(request, TEAM, { oid: OTHER_OID, role: 'user' }, key, NOW)

      expect(keyForAdd(request, TEAM, person, key, NOW)).toBe(a)
    })

    test.each([
      ['no key', undefined],
      [
        'a key this session never issued',
        '2f6a8e0c-9d2b-4a3e-8b57-6a1c0f3d9e11'
      ]
    ])(
      'makes a new key for %s, and remembers it for a retry',
      (_name, offered) => {
        const key = keyForAdd(request, TEAM, person, offered, NOW)

        expect(key).toMatch(UUID)
        expect(key).not.toBe(offered)
        expect(keyForAdd(request, TEAM, person, key, NOW)).toBe(key)
      }
    )

    test('never uses a key issued for another team', () => {
      const key = issueAddKey(request, 'other-team', NOW)

      expect(keyForAdd(request, TEAM, person, key, NOW)).not.toBe(key)
    })

    test('stays within the bound however many choices are made', () => {
      const key = issueAddKey(request, TEAM, NOW)

      for (let i = 0; i < MAX_KEYS * 3; i++) {
        keyForAdd(request, TEAM, { oid: OID, role: `role-${i}` }, key, NOW)
      }

      expect(request.store.get('addMemberKeys')).toHaveLength(MAX_KEYS)
    })

    describe('a double submit of a form whose key is no longer known (R3-2)', () => {
      test('gets one key for the same person and role when the key has expired', () => {
        const key = issueAddKey(request, TEAM, NOW)
        const later = NOW + KEY_LIFETIME_MS

        const first = keyForAdd(request, TEAM, person, key, later)
        const second = keyForAdd(request, TEAM, person, key, later)

        expect(first).toMatch(UUID)
        expect(second).toBe(first)
      })

      test('gets one key for the same person and role when the key was evicted by newer forms', () => {
        const key = issueAddKey(request, TEAM, NOW)

        for (let i = 0; i < MAX_KEYS; i++) {
          issueAddKey(request, TEAM, NOW)
        }

        const first = keyForAdd(request, TEAM, person, key, NOW)
        const second = keyForAdd(request, TEAM, person, key, NOW)

        expect(first).not.toBe(key)
        expect(second).toBe(first)
      })

      test('gets one key when the key was never issued', () => {
        const offered = '2f6a8e0c-9d2b-4a3e-8b57-6a1c0f3d9e11'

        const first = keyForAdd(request, TEAM, person, offered, NOW)
        const second = keyForAdd(request, TEAM, person, offered, NOW)

        expect(second).toBe(first)
      })

      test('gets one key for a second choice sent twice with a key already used for a first', () => {
        const key = issueAddKey(request, TEAM, NOW)
        const other = { oid: OTHER_OID, role: 'user' }

        keyForAdd(request, TEAM, person, key, NOW)

        const first = keyForAdd(request, TEAM, other, key, NOW)
        const second = keyForAdd(request, TEAM, other, key, NOW)

        expect(first).not.toBe(key)
        expect(second).toBe(first)
      })

      test('still gives another person or role, or another team, its own key', () => {
        const offered = '2f6a8e0c-9d2b-4a3e-8b57-6a1c0f3d9e11'
        const first = keyForAdd(request, TEAM, person, offered, NOW)

        const keys = [
          keyForAdd(
            request,
            TEAM,
            { oid: OTHER_OID, role: 'user' },
            offered,
            NOW
          ),
          keyForAdd(request, TEAM, { oid: OID, role: 'admin' }, offered, NOW),
          keyForAdd(request, 'other-team', person, offered, NOW)
        ]

        expect(new Set([first, ...keys]).size).toBe(4)
      })

      test('does not reuse a key that has itself expired', () => {
        const offered = '2f6a8e0c-9d2b-4a3e-8b57-6a1c0f3d9e11'
        const first = keyForAdd(request, TEAM, person, offered, NOW)

        expect(
          keyForAdd(request, TEAM, person, offered, NOW + KEY_LIFETIME_MS)
        ).not.toBe(first)
      })
    })
  })

  describe('voiding a key', () => {
    test('drops it, so the next add with it gets a new key', () => {
      const key = issueAddKey(request, TEAM, NOW)

      keyForAdd(request, TEAM, { oid: OID, role: 'user' }, key, NOW)
      voidAddKey(request, key, NOW)

      expect(
        keyForAdd(request, TEAM, { oid: OID, role: 'user' }, key, NOW)
      ).not.toBe(key)
    })
  })
})

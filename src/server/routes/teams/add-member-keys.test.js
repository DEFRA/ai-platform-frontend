import { config } from '#/config/config.js'

import {
  carryAddKey,
  issueAddKey,
  keyForAdd,
  KEY_LIFETIME_MS,
  MAX_KEYS,
  nextAddKeyGeneration,
  voidAddKey
} from './add-member-keys.js'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OID = '0b8f6f4e-3c0f-4c46-9c58-2d3a8d2f1a11'
const OTHER_OID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const TEAM = 'flood-risk-team'
const NOW = 1_000_000

// A request with only the session a key is kept in. Two requests made with
// the same id and no state are two requests of one session that each loaded
// their own snapshot of it, as concurrent requests do.
function aRequest(id = 'session-one') {
  const store = new Map()

  return {
    store,
    yar: {
      id,
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
      expect(carryAddKey(request, TEAM, key, later)).not.toBe(key)
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
      'makes a key for %s, and sends it again for a retry',
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

    test('keeps one key for the form however many choices are made with it', () => {
      const key = issueAddKey(request, TEAM, NOW)

      for (let i = 0; i < MAX_KEYS * 3; i++) {
        keyForAdd(request, TEAM, { oid: OID, role: `role-${i}` }, key, NOW)
      }

      expect(request.store.get('addMemberKeys')).toHaveLength(1)
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

      test('does not depend on the time: the key stays the same for the same operation however late the retry', () => {
        const offered = '2f6a8e0c-9d2b-4a3e-8b57-6a1c0f3d9e11'
        const first = keyForAdd(request, TEAM, person, offered, NOW)

        expect(
          keyForAdd(request, TEAM, person, offered, NOW + KEY_LIFETIME_MS)
        ).toBe(first)
      })
    })

    describe('concurrent submits that each loaded their own snapshot of the session (thread r4468297939)', () => {
      const offered = '2f6a8e0c-9d2b-4a3e-8b57-6a1c0f3d9e11'

      test('send the same key when none of them has a key this session issued', () => {
        const first = keyForAdd(aRequest(), TEAM, person, undefined, NOW)
        const second = keyForAdd(aRequest(), TEAM, person, offered, NOW)

        expect(first).toMatch(UUID)
        expect(second).toBe(first)
      })

      test('send the same key when the form key expired, in two snapshots', () => {
        const expired = aRequest()
        const key = issueAddKey(expired, TEAM, NOW)
        const later = NOW + KEY_LIFETIME_MS

        expect(keyForAdd(expired, TEAM, person, key, later)).toBe(
          keyForAdd(aRequest(), TEAM, person, key, later)
        )
      })

      test('send the same key for the same oid in another case', () => {
        expect(
          keyForAdd(
            aRequest(),
            TEAM,
            { oid: OID.toUpperCase(), role: 'user' },
            undefined,
            NOW
          )
        ).toBe(keyForAdd(aRequest(), TEAM, person, undefined, NOW))
      })

      test('never send one key for another session, person, role or team', () => {
        const keys = [
          keyForAdd(aRequest(), TEAM, person, undefined, NOW),
          keyForAdd(aRequest('session-two'), TEAM, person, undefined, NOW),
          keyForAdd(
            aRequest(),
            TEAM,
            { oid: OTHER_OID, role: 'user' },
            undefined,
            NOW
          ),
          keyForAdd(
            aRequest(),
            TEAM,
            { oid: OID, role: 'admin' },
            undefined,
            NOW
          ),
          keyForAdd(aRequest(), 'other-team', person, undefined, NOW)
        ]

        expect(new Set(keys).size).toBe(5)
      })

      test('send a new key after the generation moves on, and still the same one to each other', () => {
        const before = keyForAdd(aRequest(), TEAM, person, undefined, NOW)
        const a = aRequest()
        const b = aRequest()

        nextAddKeyGeneration(a)
        nextAddKeyGeneration(b)

        const afterA = keyForAdd(a, TEAM, person, undefined, NOW)

        expect(afterA).not.toBe(before)
        expect(keyForAdd(b, TEAM, person, undefined, NOW)).toBe(afterA)
        expect(keyForAdd(a, TEAM, person, undefined, NOW)).toBe(afterA)
      })

      test('are not derivable without the server secret', () => {
        const before = keyForAdd(aRequest(), TEAM, person, undefined, NOW)
        const password = config.get('session.cookie.password')

        try {
          config.set(
            'session.cookie.password',
            'another-password-that-is-at-least-32-characters'
          )

          expect(keyForAdd(aRequest(), TEAM, person, undefined, NOW)).not.toBe(
            before
          )
        } finally {
          config.set('session.cookie.password', password)
        }
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

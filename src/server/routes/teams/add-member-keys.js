import { createHmac, randomUUID } from 'node:crypto'

import { config } from '#/config/config.js'
import {
  getAddMemberGeneration,
  getAddMemberKeys,
  setAddMemberGeneration,
  setAddMemberKeys
} from '#/server/common/helpers/session.js'

// An add of a person to a team is one operation, and it has one idempotency
// key: issued when the form is shown and carried in the form, so a retry of
// the same operation sends the same key and the backend adds once. The
// session holds the keys it issued, each for the team it was issued for and,
// once used, the person and role it was used for: `{ key, team, choice,
// issuedAt }`. That is what stops a key from the form of another session, or
// one the page made up, from being sent, and a key from being sent for another
// person or role than the one it was first used for.
//
// A session holds a few keys at most, and a key is kept for an hour. A form
// open for longer, or after many others were opened, or with a key this
// session did not issue, is sent with a key made from the operation itself
// (an HMAC, below), not a random one, because concurrent requests of a session
// each load their own snapshot of it and the store is not atomic: a key that
// is only ever remembered in the session can differ between them, and the
// backend would then add once and refuse the other as a member that exists.

/** The most keys a session holds; the oldest is dropped first. */
export const MAX_KEYS = 10

/** How long a key is kept after it was issued. */
export const KEY_LIFETIME_MS = 60 * 60 * 1000

function live(request, now) {
  return (getAddMemberKeys(request) ?? []).filter(
    ({ issuedAt }) => now - issuedAt < KEY_LIFETIME_MS
  )
}

function remember(request, entries) {
  setAddMemberKeys(request, entries.slice(-MAX_KEYS))
}

function issued(entries, team, offered) {
  return entries.find((entry) => entry.key === offered && entry.team === team)
}

function newEntry(team, choice, now) {
  return { key: randomUUID(), team, choice, issuedAt: now }
}

const UUID_V4_VERSION = 0x40
const UUID_V4_VARIANT = 0x80

/**
 * The key for an add that has no key this session issued: an HMAC, with the
 * server's session secret, of the session, team, person, role and the
 * session's key generation, in the shape the backend's `Idempotency-Key`
 * takes (a version 4 UUID). The same operation of the same session always
 * has the same key, with nothing shared between requests, and no other
 * person, role, team or session shares it; the secret is never logged.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} team
 * @param {string} choice - `oid|role`
 * @returns {string}
 */
function derivedKey(request, team, choice) {
  const bytes = createHmac('sha256', config.get('session.cookie.password'))
    .update(
      JSON.stringify([
        'add-member-key',
        request.yar.id,
        team,
        choice,
        getAddMemberGeneration(request)
      ])
    )
    .digest()
    .subarray(0, 16)

  bytes[6] = (bytes[6] & 0x0f) | UUID_V4_VERSION
  bytes[8] = (bytes[8] & 0x3f) | UUID_V4_VARIANT

  const hex = bytes.toString('hex')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-')
}

/**
 * Moves the session's key generation on, so the key made for a person and
 * role without a form key is a new one: call it after an add has succeeded or
 * its key was refused as reused. Requests that load the same snapshot move it
 * to the same value, so they still agree.
 * @param {import('@hapi/hapi').Request} request
 */
export function nextAddKeyGeneration(request) {
  setAddMemberGeneration(request, getAddMemberGeneration(request) + 1)
}

/**
 * Issues a key for a form that is shown.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} team - The team slug.
 * @param {number} [now]
 * @returns {string}
 */
export function issueAddKey(request, team, now = Date.now()) {
  const entry = newEntry(team, undefined, now)

  remember(request, [...live(request, now), entry])

  return entry.key
}

/**
 * The key for a page of the form that comes back to the admin: the one the
 * form came with when this session issued it for this team, and otherwise a
 * new one.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} team - The team slug.
 * @param {unknown} offered - What the form came with.
 * @param {number} [now]
 * @returns {string}
 */
export function carryAddKey(request, team, offered, now = Date.now()) {
  return issued(live(request, now), team, offered)
    ? offered
    : issueAddKey(request, team, now)
}

/**
 * The key to add a person with a role with: the one the form came with for a
 * first use or a retry of the same person and role. When the form's key is not
 * one this session issued for this team (expired, evicted, made up, or used
 * for another person or role), it is the key made from the session, team,
 * person, role and key generation, so concurrent submits of such a form, each
 * with its own snapshot of the session, send one key and are one operation.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} team - The team slug.
 * @param {{oid: string, role: string}} person
 * @param {unknown} offered - What the form came with.
 * @param {number} [now]
 * @returns {string}
 */
export function keyForAdd(
  request,
  team,
  { oid, role },
  offered,
  now = Date.now()
) {
  const choice = `${oid.toLowerCase()}|${role}`
  const entries = live(request, now)
  const entry = issued(entries, team, offered)

  if (entry?.choice === choice) {
    return entry.key
  }

  if (entry && !entry.choice) {
    remember(
      request,
      entries.map((each) => (each === entry ? { ...each, choice } : each))
    )

    return entry.key
  }

  return derivedKey(request, team, choice)
}

/**
 * Forgets a key, so that it is never sent again.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} key
 * @param {number} [now]
 */
export function voidAddKey(request, key, now = Date.now()) {
  remember(
    request,
    live(request, now).filter((entry) => entry.key !== key)
  )
}

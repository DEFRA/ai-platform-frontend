import { randomUUID } from 'node:crypto'

import {
  getAddMemberKeys,
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
// A session holds a few keys at most, and a key is kept for an hour: a form
// open for longer, or after many others were opened, is sent with a new key.

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
 * first use or a retry of the same person and role, and a new one (kept for
 * its own retry) when the form's key is not one this session issued for this
 * team, or was used for another person or role.
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

  const fresh = newEntry(team, choice, now)

  remember(request, [...entries, fresh])

  return fresh.key
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

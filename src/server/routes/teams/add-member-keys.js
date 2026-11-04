import { createHmac, randomUUID } from 'node:crypto'

import { config } from '#/config/config.js'
import {
  getAddMemberGeneration,
  getAddMemberKeys,
  setAddMemberGeneration,
  setAddMemberKeys
} from '#/server/common/helpers/session.js'

// An add of a person to a team is one operation. A form carries a key the
// session issued for it when it was shown (`{ key, team, issuedAt }`); that is
// what stops a key from the form of another session, or one the page made up,
// from being trusted. The key sent to the backend is not the form's own: it is
// made from the session, team, the form's key and the person and role chosen
// (an HMAC, below), so a retry of the same choice from the same form sends the
// same key and the backend adds once, another choice from the form has its own
// key, and none of it depends on what other tabs do. Pages of the form that
// come back (a search, a refusal) carry the form's key, so it is always
// recognised.
//
// A session holds a few keys at most, and a key is kept for an hour. A form
// open for longer, or after many others were opened, or with a key this
// session did not issue, is sent with a key made from the operation itself
// and the session's key generation, which moves on after an add succeeds,
// because concurrent requests of a session each load their own snapshot of it
// and the store is not atomic: a key that is only ever remembered in the
// session can differ between them, and the backend would then add once and
// refuse the other as a member that exists.

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

function newEntry(team, now) {
  return { key: randomUUID(), team, issuedAt: now }
}

// A version 4 UUID is 16 bytes: the high nibble of byte 6 is the version (4)
// and the two high bits of byte 8 are the variant (10), shown in 5 groups.
const UUID_BYTES = 16
const UUID_VERSION_BYTE = 6
const UUID_VARIANT_BYTE = 8
const UUID_V4_VERSION = 0x40
const UUID_V4_VARIANT = 0x80
const UUID_GROUPS = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/

/**
 * Makes a key in the shape the backend's `Idempotency-Key` takes (a version 4
 * UUID) from an HMAC, with the server's session secret, of the parts given.
 * The same parts always give the same key, with nothing shared between
 * requests, and the secret is never logged.
 * @param {unknown[]} parts
 * @returns {string}
 */
function derivedKey(parts) {
  const bytes = createHmac('sha256', config.get('session.cookie.password'))
    .update(JSON.stringify(parts))
    .digest()
    .subarray(0, UUID_BYTES)

  bytes[UUID_VERSION_BYTE] = (bytes[UUID_VERSION_BYTE] & 0x0f) | UUID_V4_VERSION
  bytes[UUID_VARIANT_BYTE] = (bytes[UUID_VARIANT_BYTE] & 0x3f) | UUID_V4_VARIANT

  return bytes.toString('hex').replace(UUID_GROUPS, '$1-$2-$3-$4-$5')
}

/**
 * The key for a choice made with a form this session issued: from the
 * session, team, the form's key and the person and role. It does not depend on
 * anything else the session does, so a retry of the same choice from the same
 * form is the same add whatever other tabs have done, and another choice from
 * the same form has a key of its own.
 */
function keyForFormChoice(request, team, formKey, choice) {
  return derivedKey([
    'add-member-form-key',
    request.yar.id,
    team,
    formKey,
    choice
  ])
}

/**
 * The key for an add with no key this session issued: from the session, team,
 * person, role and the session's key generation. The same operation of the
 * same session has the same key until the generation moves on.
 */
function keyForKeylessChoice(request, team, choice) {
  return derivedKey([
    'add-member-key',
    request.yar.id,
    team,
    choice,
    getAddMemberGeneration(request)
  ])
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
  const entry = newEntry(team, now)

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
 * The key to add a person with a role with. When the form's key is one this
 * session issued for this team, it is the key made from the session, team,
 * the form's key, person and role: the same for every retry of that choice
 * from that form, whatever else the session has done, and its own for another
 * choice from the form. When it is not (expired, evicted or made up), it is
 * the key made from the session, team, person, role and key generation, so
 * concurrent submits of such a form, each with its own snapshot of the
 * session, send one key and are one operation.
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

  return issued(live(request, now), team, offered)
    ? keyForFormChoice(request, team, offered, choice)
    : keyForKeylessChoice(request, team, choice)
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

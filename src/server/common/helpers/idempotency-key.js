import { createHmac } from 'node:crypto'

import { config } from '#/config/config.js'

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
 * @param {unknown[]} parts - What the operation is made of; put the kind of
 *   operation first so that two kinds never share a key.
 * @returns {string}
 */
export function derivedIdempotencyKey(parts) {
  const bytes = createHmac('sha256', config.get('session.cookie.password'))
    .update(JSON.stringify(parts))
    .digest()
    .subarray(0, UUID_BYTES)

  bytes[UUID_VERSION_BYTE] = (bytes[UUID_VERSION_BYTE] & 0x0f) | UUID_V4_VERSION
  bytes[UUID_VARIANT_BYTE] = (bytes[UUID_VARIANT_BYTE] & 0x3f) | UUID_V4_VARIANT

  return bytes.toString('hex').replace(UUID_GROUPS, '$1-$2-$3-$4-$5')
}

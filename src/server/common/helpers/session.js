const SESSION_USER_KEY = 'user'
const PLATFORM_ADMIN_KEY = 'isPlatformAdmin'
const PENDING_ACCESS_KEY = 'pendingAccess'
const REQUESTED_DEPLOYMENTS_KEY = 'requestedDeployments'
const PENDING_TEAM_KEY = 'pendingTeam'
const ISSUED_CREDENTIAL_KEY = 'issuedCredential'
const ADDED_CLIENT_SECRET_KEY = 'addedClientSecret'
const OIDC_LOGIN_KEY = 'oidcLogin'
const ACCOUNT_NOTIFICATION_KEY = 'accountNotification'
const SESSION_CLOCK_KEY = 'sessionClock'
const TOKENS_KEY = 'tokens'
const ADD_MEMBER_KEYS = 'addMemberKeys'
const ADD_MEMBER_GENERATION = 'addMemberGeneration'
const PENDING_LIMITS_KEY = 'pendingLimits'
const ENVIRONMENTS_TEAM_KEY = 'environmentsTeam'
const PENDING_CLIENT_SECRET_KEY = 'pendingClientSecret'
const PENDING_FEDERATION_KEY = 'pendingFederation'
const REQUESTED_FEDERATIONS_KEY = 'requestedFederations'
const MAX_REQUESTED_FEDERATIONS = 5

// When the person signed in and when they last made a request: the two
// times the idle and overall session limits are measured from.
export function getSessionClock(request) {
  return request.yar.get(SESSION_CLOCK_KEY)
}

export function setSessionClock(request, value) {
  request.yar.set(SESSION_CLOCK_KEY, value)
}

// The person's access and refresh tokens, and when the access token ends.
// They live in the server-side session and nowhere else: never in a cookie,
// a page or a log. Reading is safe on a request with no session store (a
// 404), as for the signed-in user.
export function getSessionTokens(request) {
  try {
    return request.yar?.get(TOKENS_KEY)
  } catch {
    return undefined
  }
}

export function setSessionTokens(request, tokens) {
  request.yar.set(TOKENS_KEY, tokens)
}

export function getSessionUser(request) {
  // yar's session store is only initialised for matched routes (onPreAuth
  // never runs for 404s), so reading it for e.g. the error page must not throw.
  try {
    return request.yar?.get(SESSION_USER_KEY)
  } catch {
    return undefined
  }
}

export function setSessionUser(request, user) {
  request.yar.set(SESSION_USER_KEY, user)
}

// Whether the backend said, when the person signed in, that they are a
// Platform Admin. It only decides whether the Admin link is shown: every
// `/admin` page asks the backend again, and the backend is the control. Reading
// is safe on a request with no session store, as for the signed-in user.
export function isSessionPlatformAdmin(request) {
  try {
    return request.yar?.get(PLATFORM_ADMIN_KEY) === true
  } catch {
    return false
  }
}

export function setSessionPlatformAdmin(request, value) {
  request.yar.set(PLATFORM_ADMIN_KEY, value === true)
}

// The backend refused an admin page, so the link is no longer true.
export function clearSessionPlatformAdmin(request) {
  request.yar.clear(PLATFORM_ADMIN_KEY)
}

export function getPendingAccess(request) {
  return request.yar.get(PENDING_ACCESS_KEY)
}

export function setPendingAccess(request, value) {
  request.yar.set(PENDING_ACCESS_KEY, value)
}

// A finished or abandoned connect journey must not seed the next one.
export function clearPendingAccess(request) {
  request.yar.clear(PENDING_ACCESS_KEY)
}

// The deployments one team request made, so its wait page can follow them
// all (`{ teamSlug, ids }`); the page falls back to the one in its address
// when this is gone.
export function getRequestedDeployments(request) {
  return request.yar.get(REQUESTED_DEPLOYMENTS_KEY)
}

export function setRequestedDeployments(request, value) {
  request.yar.set(REQUESTED_DEPLOYMENTS_KEY, value)
}

// Ends the whole session, and with it everything a person left in it
// (journey state, a credential not yet shown, notifications), so the next
// person on this browser starts clean.
export function resetSession(request) {
  request.yar.reset()
}

export function getPendingTeam(request) {
  return request.yar.get(PENDING_TEAM_KEY)
}

export function setPendingTeam(request, value) {
  request.yar.set(PENDING_TEAM_KEY, value)
}

export function clearPendingTeam(request) {
  request.yar.clear(PENDING_TEAM_KEY)
}

export function setIssuedCredential(request, value) {
  request.yar.set(ISSUED_CREDENTIAL_KEY, value)
}

// One-render only: reading it also clears it from the session.
export function takeIssuedCredential(request) {
  const credential = request.yar.get(ISSUED_CREDENTIAL_KEY)
  request.yar.clear(ISSUED_CREDENTIAL_KEY)
  return credential
}

// One-render only, and only for the page it is for: a result that `matches`
// is returned and cleared; any other is left in the session for its own page.
export function takeIssuedCredentialIf(request, matches) {
  const credential = request.yar.get(ISSUED_CREDENTIAL_KEY)

  if (!credential || !matches(credential)) {
    return undefined
  }

  request.yar.clear(ISSUED_CREDENTIAL_KEY)
  return credential
}

// The client secret an admin has just added, shown once on its own page. It has
// a slot of its own, so another journey that takes an issued credential (a
// personal key's page) neither clears it nor fails on it.
export function setAddedClientSecret(request, value) {
  request.yar.set(ADDED_CLIENT_SECRET_KEY, value)
}

// One-render only, and only for the page it is for.
export function takeAddedClientSecretIf(request, matches) {
  const added = request.yar.get(ADDED_CLIENT_SECRET_KEY)

  if (!added || !matches(added)) {
    return undefined
  }

  request.yar.clear(ADDED_CLIENT_SECRET_KEY)
  return added
}

export function setOidcLoginState(request, value) {
  request.yar.set(OIDC_LOGIN_KEY, value)
}

// One-use only: the PKCE/state/nonce values are redeemed by the /auth/callback handler.
export function takeOidcLoginState(request) {
  const value = request.yar.get(OIDC_LOGIN_KEY)
  request.yar.clear(OIDC_LOGIN_KEY)
  return value
}

// The idempotency keys the add form has issued, each for its own add
// (`[{ key, team, choice, issuedAt }]`, a few at most): see add-member-keys.js.
export function getAddMemberKeys(request) {
  return request.yar.get(ADD_MEMBER_KEYS)
}

export function setAddMemberKeys(request, value) {
  request.yar.set(ADD_MEMBER_KEYS, value)
}

// A number that moves on after an add has succeeded or its key was refused as
// reused, so the key made for a person and role without a form key is a new
// one for the next add of them: see add-member-keys.js.
export function getAddMemberGeneration(request) {
  return request.yar.get(ADD_MEMBER_GENERATION) ?? 0
}

export function setAddMemberGeneration(request, value) {
  request.yar.set(ADD_MEMBER_GENERATION, value)
}

// The limits a person has asked for and not yet confirmed, with the key that
// makes confirming them the same request however many times it is sent
// (`{ userId, teamSlug, environment, tokensPerMinute, requestsPerMinute, key }`).
export function getPendingLimits(request) {
  return request.yar.get(PENDING_LIMITS_KEY)
}

export function setPendingLimits(request, value) {
  request.yar.set(PENDING_LIMITS_KEY, value)
}

export function clearPendingLimits(request) {
  request.yar.clear(PENDING_LIMITS_KEY)
}

// The add of a client secret that was asked for and has not been answered (the
// backend timed out or could not be read again), with the key and name it was
// asked with, so adding again is the same request even if the first one was
// made. Holds no secret value.
export function getPendingClientSecret(request) {
  return request.yar.get(PENDING_CLIENT_SECRET_KEY)
}

export function setPendingClientSecret(request, value) {
  request.yar.set(PENDING_CLIENT_SECRET_KEY, value)
}

export function clearPendingClientSecret(request) {
  request.yar.clear(PENDING_CLIENT_SECRET_KEY)
}

// The team slug whose environments the person last looked at, so the
// Environments link returns to it.
export function getEnvironmentsTeam(request) {
  return request.yar.get(ENVIRONMENTS_TEAM_KEY)
}

export function setEnvironmentsTeam(request, slug) {
  request.yar.set(ENVIRONMENTS_TEAM_KEY, slug)
}

// The application a person is federating (or changing) and has not yet
// confirmed, with the key that makes confirming it the same request however
// many times it is sent (see routes/environments/federation-journey.js).
export function getPendingFederation(request) {
  return request.yar.get(PENDING_FEDERATION_KEY)
}

export function setPendingFederation(request, value) {
  request.yar.set(PENDING_FEDERATION_KEY, value)
}

export function clearPendingFederation(request) {
  request.yar.clear(PENDING_FEDERATION_KEY)
}

// The applications just federated, each by an id of its own, with the operation
// each environment made for it (`{ userId, teamSlug, name, items: [{
// environment, operationId }] }`), so the page that follows one shows its
// progress and not another's. Only the latest few are kept: they are for the
// page that follows, not a history.
export function getRequestedFederation(request, id) {
  return request.yar.get(REQUESTED_FEDERATIONS_KEY)?.[id]
}

export function addRequestedFederation(request, id, value) {
  const held = Object.entries(request.yar.get(REQUESTED_FEDERATIONS_KEY) ?? {})
    .filter(([key]) => key !== id)
    .slice(1 - MAX_REQUESTED_FEDERATIONS)

  request.yar.set(
    REQUESTED_FEDERATIONS_KEY,
    Object.fromEntries([...held, [id, value]])
  )
}

export function setAccountNotification(request, value) {
  request.yar.set(ACCOUNT_NOTIFICATION_KEY, value)
}

// One-render only: reading it also clears it from the session.
export function takeAccountNotification(request) {
  const notification = request.yar.get(ACCOUNT_NOTIFICATION_KEY)
  request.yar.clear(ACCOUNT_NOTIFICATION_KEY)
  return notification
}

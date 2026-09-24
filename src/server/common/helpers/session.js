const SESSION_USER_KEY = 'user'
const PENDING_ACCESS_KEY = 'pendingAccess'
const PENDING_TEAM_KEY = 'pendingTeam'
const ISSUED_CREDENTIAL_KEY = 'issuedCredential'
const OIDC_LOGIN_KEY = 'oidcLogin'
const ACCOUNT_NOTIFICATION_KEY = 'accountNotification'

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

export function clearSessionUser(request) {
  request.yar.clear(SESSION_USER_KEY)
}

export function getPendingAccess(request) {
  return request.yar.get(PENDING_ACCESS_KEY)
}

export function setPendingAccess(request, value) {
  request.yar.set(PENDING_ACCESS_KEY, value)
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

export function setOidcLoginState(request, value) {
  request.yar.set(OIDC_LOGIN_KEY, value)
}

// One-use only: the PKCE/state/nonce values are redeemed by the /auth/callback handler.
export function takeOidcLoginState(request) {
  const value = request.yar.get(OIDC_LOGIN_KEY)
  request.yar.clear(OIDC_LOGIN_KEY)
  return value
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

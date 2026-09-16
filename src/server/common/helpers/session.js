const SESSION_USER_KEY = 'user'
const PENDING_ACCESS_KEY = 'pendingAccess'
const ISSUED_CREDENTIAL_KEY = 'issuedCredential'

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

export function setIssuedCredential(request, value) {
  request.yar.set(ISSUED_CREDENTIAL_KEY, value)
}

// One-render only: reading it also clears it from the session.
export function takeIssuedCredential(request) {
  const credential = request.yar.get(ISSUED_CREDENTIAL_KEY)
  request.yar.clear(ISSUED_CREDENTIAL_KEY)
  return credential
}

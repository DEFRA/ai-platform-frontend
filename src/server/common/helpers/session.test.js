import {
  getSessionUser,
  getSessionTokens,
  setSessionTokens,
  setSessionUser,
  getPendingAccess,
  setPendingAccess,
  clearPendingAccess,
  getPendingLimits,
  setPendingLimits,
  clearPendingLimits,
  getPendingFederation,
  setPendingFederation,
  clearPendingFederation,
  getRequestedFederations,
  setRequestedFederations,
  getRequestedDeployments,
  setRequestedDeployments,
  resetSession,
  setIssuedCredential,
  takeIssuedCredential,
  takeIssuedCredentialIf
} from './session.js'

function mockRequest() {
  let store = {}

  return {
    yar: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value
      },
      clear: (key) => {
        delete store[key]
      },
      reset: () => {
        store = {}
      }
    }
  }
}

describe('#session helpers', () => {
  test('keeps the limits a person has asked for until they are cleared', () => {
    const request = mockRequest()

    expect(getPendingLimits(request)).toBeUndefined()

    setPendingLimits(request, { key: 'k', tokensPerMinute: 2000 })
    expect(getPendingLimits(request)).toEqual({
      key: 'k',
      tokensPerMinute: 2000
    })

    clearPendingLimits(request)
    expect(getPendingLimits(request)).toBeUndefined()
  })

  test('keeps the application a person is federating until it is cleared', () => {
    const request = mockRequest()

    expect(getPendingFederation(request)).toBeUndefined()

    setPendingFederation(request, { key: 'k', host: 'cdp' })
    expect(getPendingFederation(request)).toEqual({ key: 'k', host: 'cdp' })

    clearPendingFederation(request)
    expect(getPendingFederation(request)).toBeUndefined()
  })

  test('remembers the applications just federated, for the page that follows them', () => {
    const request = mockRequest()

    expect(getRequestedFederations(request)).toBeUndefined()

    setRequestedFederations(request, { name: 'flood-api' })
    expect(getRequestedFederations(request)).toEqual({ name: 'flood-api' })
  })

  test('keeps the tokens in the session, and reading them on a request with no session store is safe', () => {
    const request = mockRequest()

    expect(getSessionTokens(request)).toBeUndefined()

    setSessionTokens(request, { accessToken: 'a', refreshToken: 'r' })
    expect(getSessionTokens(request)).toEqual({
      accessToken: 'a',
      refreshToken: 'r'
    })

    expect(getSessionTokens({})).toBeUndefined()
    expect(
      getSessionTokens({
        yar: {
          get: () => {
            throw new Error('no session store')
          }
        }
      })
    ).toBeUndefined()
  })

  test('ends the tokens with the session', () => {
    const request = mockRequest()
    setSessionTokens(request, { accessToken: 'a' })

    resetSession(request)

    expect(getSessionTokens(request)).toBeUndefined()
  })

  test('sets and gets the session user', () => {
    const request = mockRequest()

    expect(getSessionUser(request)).toBeUndefined()

    setSessionUser(request, { id: 'user-1' })
    expect(getSessionUser(request)).toEqual({ id: 'user-1' })
  })

  test('sets, gets and clears pending access', () => {
    const request = mockRequest()

    setPendingAccess(request, { provider: 'openai' })
    expect(getPendingAccess(request)).toEqual({ provider: 'openai' })

    clearPendingAccess(request)
    expect(getPendingAccess(request)).toBeUndefined()
  })

  test('sets and gets the deployments a team request made', () => {
    const request = mockRequest()

    setRequestedDeployments(request, { teamSlug: 't1', ids: ['a', 'b'] })
    expect(getRequestedDeployments(request)).toEqual({
      teamSlug: 't1',
      ids: ['a', 'b']
    })
  })

  test('resetSession drops everything a person left in the session', () => {
    const request = mockRequest()

    setSessionUser(request, { id: 'user-1' })
    setPendingAccess(request, { teamId: 't1' })
    setRequestedDeployments(request, { teamId: 't1', ids: ['a'] })
    setIssuedCredential(request, { secret: 'mock_secret' })

    resetSession(request)

    expect(getSessionUser(request)).toBeUndefined()
    expect(getPendingAccess(request)).toBeUndefined()
    expect(getRequestedDeployments(request)).toBeUndefined()
    expect(takeIssuedCredential(request)).toBeUndefined()
  })

  test('takeIssuedCredential returns and clears the credential', () => {
    const request = mockRequest()

    setIssuedCredential(request, { secret: 'mock_secret' })
    expect(takeIssuedCredential(request)).toEqual({ secret: 'mock_secret' })
    expect(takeIssuedCredential(request)).toBeUndefined()
  })

  test('takeIssuedCredentialIf returns and clears only a result that matches', () => {
    const request = mockRequest()

    setIssuedCredential(request, { secret: 'mock_secret', credentialId: 'a' })

    expect(
      takeIssuedCredentialIf(
        request,
        ({ credentialId }) => credentialId === 'b'
      )
    ).toBeUndefined()
    // The result for another page is still there for its own.
    expect(
      takeIssuedCredentialIf(
        request,
        ({ credentialId }) => credentialId === 'a'
      )
    ).toEqual({ secret: 'mock_secret', credentialId: 'a' })
    expect(takeIssuedCredentialIf(request, () => true)).toBeUndefined()
  })
})

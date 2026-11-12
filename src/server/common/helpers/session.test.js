import {
  getSessionUser,
  getSessionTokens,
  setSessionTokens,
  setSessionUser,
  isSessionPlatformAdmin,
  setSessionPlatformAdmin,
  clearSessionPlatformAdmin,
  getPendingAccess,
  setPendingAccess,
  clearPendingAccess,
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

  test('keeps whether the person is a Platform Admin, false until the backend says so, and clears it', () => {
    const request = mockRequest()

    expect(isSessionPlatformAdmin(request)).toBe(false)

    setSessionPlatformAdmin(request, true)
    expect(isSessionPlatformAdmin(request)).toBe(true)

    clearSessionPlatformAdmin(request)
    expect(isSessionPlatformAdmin(request)).toBe(false)
  })

  test('keeps only an answer of true as a Platform Admin', () => {
    const request = mockRequest()

    for (const answer of [undefined, null, 'true', 1, false]) {
      setSessionPlatformAdmin(request, answer)
      expect(isSessionPlatformAdmin(request)).toBe(false)
    }
  })

  test('reads whether the person is a Platform Admin safely on a request with no session store', () => {
    expect(isSessionPlatformAdmin({})).toBe(false)
    expect(
      isSessionPlatformAdmin({
        yar: {
          get: () => {
            throw new Error('no session store')
          }
        }
      })
    ).toBe(false)
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

import {
  getSessionUser,
  setSessionUser,
  getPendingAccess,
  setPendingAccess,
  clearPendingAccess,
  getRequestedDeployments,
  setRequestedDeployments,
  resetSession,
  setIssuedCredential,
  takeIssuedCredential
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
})

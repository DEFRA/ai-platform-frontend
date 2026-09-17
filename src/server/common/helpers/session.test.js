import {
  getSessionUser,
  setSessionUser,
  clearSessionUser,
  getPendingAccess,
  setPendingAccess,
  setIssuedCredential,
  takeIssuedCredential
} from './session.js'

function mockRequest() {
  const store = {}

  return {
    yar: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value
      },
      clear: (key) => {
        delete store[key]
      }
    }
  }
}

describe('#session helpers', () => {
  test('sets, gets and clears the session user', () => {
    const request = mockRequest()

    expect(getSessionUser(request)).toBeUndefined()

    setSessionUser(request, { id: 'user-1' })
    expect(getSessionUser(request)).toEqual({ id: 'user-1' })

    clearSessionUser(request)
    expect(getSessionUser(request)).toBeUndefined()
  })

  test('sets and gets pending access', () => {
    const request = mockRequest()

    setPendingAccess(request, { provider: 'openai' })
    expect(getPendingAccess(request)).toEqual({ provider: 'openai' })
  })

  test('takeIssuedCredential returns and clears the credential', () => {
    const request = mockRequest()

    setIssuedCredential(request, { secret: 'mock_secret' })
    expect(takeIssuedCredential(request)).toEqual({ secret: 'mock_secret' })
    expect(takeIssuedCredential(request)).toBeUndefined()
  })
})

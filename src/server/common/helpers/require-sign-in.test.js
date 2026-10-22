import { requireSignIn } from './require-sign-in.js'

function mockRequest(user, search = '') {
  return {
    path: '/connect/team/start',
    url: { search },
    yar: {
      get: () => user
    }
  }
}

function mockToolkit() {
  return {
    redirect: vi.fn().mockReturnThis(),
    takeover: vi.fn().mockReturnValue('redirected'),
    continue: 'continue'
  }
}

describe('#requireSignIn', () => {
  test('redirects to /sign-in with a returnTo when signed out', () => {
    const request = mockRequest(undefined)
    const h = mockToolkit()

    const result = requireSignIn(request, h)

    expect(h.redirect).toHaveBeenCalledWith(
      '/sign-in?returnTo=%2Fconnect%2Fteam%2Fstart'
    )
    expect(result).toBe('redirected')
  })

  test('keeps the query in the returnTo, so a named model survives signing in', () => {
    const request = mockRequest(undefined, '?modelSlug=gpt-4o')
    const h = mockToolkit()

    requireSignIn(request, h)

    expect(h.redirect).toHaveBeenCalledWith(
      '/sign-in?returnTo=%2Fconnect%2Fteam%2Fstart%3FmodelSlug%3Dgpt-4o'
    )
  })

  test('continues when signed in', () => {
    const request = mockRequest({ id: 'user-1' })
    const h = mockToolkit()

    expect(requireSignIn(request, h)).toBe('continue')
  })
})

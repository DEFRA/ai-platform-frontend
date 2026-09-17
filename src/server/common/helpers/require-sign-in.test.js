import { requireSignIn } from './require-sign-in.js'

function mockRequest(user) {
  return {
    path: '/connect-model',
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
      '/sign-in?returnTo=%2Fconnect-model'
    )
    expect(result).toBe('redirected')
  })

  test('continues when signed in', () => {
    const request = mockRequest({ id: 'user-1' })
    const h = mockToolkit()

    expect(requireSignIn(request, h)).toBe('continue')
  })
})

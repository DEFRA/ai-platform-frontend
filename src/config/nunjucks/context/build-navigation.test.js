import { buildNavigation } from './build-navigation.js'

function mockRequest(options, { signedIn = false, pending = false } = {}) {
  return {
    ...options,
    yar: {
      get: (key) => {
        if (signedIn && key === 'user') return { displayName: 'Dev User' }
        if (pending && key === 'pendingOidcIdentity') {
          return { displayName: 'Dev User' }
        }
        return undefined
      }
    }
  }
}

describe('#buildNavigation', () => {
  test('Should hide "Connect to model" when signed out', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })

  test('Should provide expected navigation details when signed in', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/non-existent-path' }, { signedIn: true })
      )
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Connect to model',
        href: '/connect-model'
      },
      {
        current: false,
        text: 'Account',
        href: '/account'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })

  test('Should show "Connect to model" once Entra ID login succeeds, before the team step', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/non-existent-path' }, { pending: true })
      )
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Connect to model',
        href: '/connect-model'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })

  test('Should hide "Account" until the team step is finished, unlike "Connect to model"', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/non-existent-path' }, { pending: true })
      )
    ).not.toContainEqual(expect.objectContaining({ text: 'Account' }))
  })

  test('Should provide expected highlighted navigation details', () => {
    expect(
      buildNavigation(mockRequest({ path: '/' }, { signedIn: true }))
    ).toEqual([
      {
        current: true,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Connect to model',
        href: '/connect-model'
      },
      {
        current: false,
        text: 'Account',
        href: '/account'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })

  test('Should highlight Connect to model for its sub-routes', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/connect-model/select-model' }, { signedIn: true })
      )
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: true,
        text: 'Connect to model',
        href: '/connect-model'
      },
      {
        current: false,
        text: 'Account',
        href: '/account'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })

  test('Should highlight Account for its sub-routes', () => {
    expect(
      buildNavigation(
        mockRequest(
          { path: '/account/credentials/1/revoke' },
          { signedIn: true }
        )
      )
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Connect to model',
        href: '/connect-model'
      },
      {
        current: true,
        text: 'Account',
        href: '/account'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })
})

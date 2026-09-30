import { buildNavigation } from './build-navigation.js'

function mockRequest(options, { signedIn = false } = {}) {
  return {
    ...options,
    yar: {
      get: (key) => {
        if (signedIn && key === 'user') return { displayName: 'Dev User' }
        return undefined
      }
    }
  }
}

describe('#buildNavigation', () => {
  test('Should hide "Your access" when signed out', () => {
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
        text: 'Models',
        href: '/models'
      },
      {
        current: false,
        text: 'Help',
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
        text: 'Models',
        href: '/models'
      },
      {
        current: false,
        text: 'Your access',
        href: '/manage'
      },
      {
        current: false,
        text: 'Help',
        href: '/about'
      }
    ])
  })

  test('Should highlight Home', () => {
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
        text: 'Models',
        href: '/models'
      },
      {
        current: false,
        text: 'Your access',
        href: '/manage'
      },
      {
        current: false,
        text: 'Help',
        href: '/about'
      }
    ])
  })

  test('Should highlight Models for its sub-routes', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/models/gpt-4o' }, { signedIn: true })
      )
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: true,
        text: 'Models',
        href: '/models'
      },
      {
        current: false,
        text: 'Your access',
        href: '/manage'
      },
      {
        current: false,
        text: 'Help',
        href: '/about'
      }
    ])
  })

  test('Should highlight Your access for its sub-routes', () => {
    expect(
      buildNavigation(
        mockRequest(
          { path: '/manage/credentials/1/revoke' },
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
        text: 'Models',
        href: '/models'
      },
      {
        current: true,
        text: 'Your access',
        href: '/manage'
      },
      {
        current: false,
        text: 'Help',
        href: '/about'
      }
    ])
  })

  test('Should highlight Help', () => {
    expect(
      buildNavigation(mockRequest({ path: '/about' }, { signedIn: true }))
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Models',
        href: '/models'
      },
      {
        current: false,
        text: 'Your access',
        href: '/manage'
      },
      {
        current: true,
        text: 'Help',
        href: '/about'
      }
    ])
  })
})

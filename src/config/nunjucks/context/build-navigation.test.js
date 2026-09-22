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
  test('Should hide "Manage AI access" when signed out', () => {
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
        text: 'Browse models',
        href: '/models'
      },
      {
        current: false,
        text: 'Connect to a model',
        href: '/connect'
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
        text: 'Browse models',
        href: '/models'
      },
      {
        current: false,
        text: 'Connect to a model',
        href: '/connect'
      },
      {
        current: false,
        text: 'Manage AI access',
        href: '/manage'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
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
        text: 'Browse models',
        href: '/models'
      },
      {
        current: false,
        text: 'Connect to a model',
        href: '/connect'
      },
      {
        current: false,
        text: 'Manage AI access',
        href: '/manage'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })

  test('Should highlight Connect to a model for its sub-routes', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/connect/shared/model' }, { signedIn: true })
      )
    ).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Browse models',
        href: '/models'
      },
      {
        current: true,
        text: 'Connect to a model',
        href: '/connect'
      },
      {
        current: false,
        text: 'Manage AI access',
        href: '/manage'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })

  test('Should highlight Manage AI access for its sub-routes', () => {
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
        text: 'Browse models',
        href: '/models'
      },
      {
        current: false,
        text: 'Connect to a model',
        href: '/connect'
      },
      {
        current: true,
        text: 'Manage AI access',
        href: '/manage'
      },
      {
        current: false,
        text: 'About',
        href: '/about'
      }
    ])
  })
})

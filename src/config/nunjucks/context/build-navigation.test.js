import { buildNavigation } from './build-navigation.js'

function mockRequest(options) {
  return { ...options }
}

describe('#buildNavigation', () => {
  test('Should provide expected navigation details', () => {
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

  test('Should provide expected highlighted navigation details', () => {
    expect(buildNavigation(mockRequest({ path: '/' }))).toEqual([
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
        text: 'About',
        href: '/about'
      }
    ])
  })

  test('Should highlight Connect to model for its sub-routes', () => {
    expect(
      buildNavigation(mockRequest({ path: '/connect-model/select-model' }))
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
        text: 'About',
        href: '/about'
      }
    ])
  })
})

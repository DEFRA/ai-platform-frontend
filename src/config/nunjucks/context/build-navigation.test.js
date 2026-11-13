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

function currentItems(navigation) {
  return navigation.filter((item) => item.current).map((item) => item.text)
}

describe('#buildNavigation', () => {
  test('Should show Model catalogue and Help only, with no Home, when signed out', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([
      { text: 'Model catalogue', href: '/models', current: false },
      { text: 'Help', href: '/about', current: false }
    ])
  })

  test('Should show Model catalogue, Personal access, Teams, Environments and Help in order when signed in', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/non-existent-path' }, { signedIn: true })
      )
    ).toEqual([
      { text: 'Model catalogue', href: '/models', current: false },
      { text: 'Personal access', href: '/manage', current: false },
      { text: 'Teams', href: '/teams', current: false },
      { text: 'Environments', href: '/environments', current: false },
      { text: 'Help', href: '/about', current: false }
    ])
  })

  test.each([
    ['/models', 'Model catalogue'],
    ['/models/gpt-4o', 'Model catalogue'],
    ['/manage', 'Personal access'],
    ['/manage/credentials/1/revoke', 'Personal access'],
    ['/teams', 'Teams'],
    ['/teams/flood-risk-mapping', 'Teams'],
    ['/teams/flood-risk-mapping/members', 'Teams'],
    ['/environments', 'Environments'],
    ['/environments/flood-risk-mapping', 'Environments'],
    ['/environments/flood-risk-mapping/infradev/limits', 'Environments'],
    ['/about', 'Help']
  ])('Should highlight only the item for %s when signed in', (path, text) => {
    expect(
      currentItems(buildNavigation(mockRequest({ path }, { signedIn: true })))
    ).toEqual([text])
  })

  test('Should highlight nothing on the home page, which has no item', () => {
    expect(
      currentItems(
        buildNavigation(mockRequest({ path: '/' }, { signedIn: true }))
      )
    ).toEqual([])
  })

  test('Should not show Personal access, Teams or Environments to a signed out person on a teams address', () => {
    const navigation = buildNavigation(mockRequest({ path: '/teams' }))

    expect(navigation.map((item) => item.text)).toEqual([
      'Model catalogue',
      'Help'
    ])
    expect(currentItems(navigation)).toEqual([])
  })

  test('Should cope with a request that has no path', () => {
    expect(
      currentItems(buildNavigation(mockRequest({}, { signedIn: true })))
    ).toEqual([])
  })
})

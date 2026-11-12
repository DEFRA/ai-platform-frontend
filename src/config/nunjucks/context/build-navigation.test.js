import { buildNavigation } from './build-navigation.js'

function mockRequest(
  options,
  { signedIn = false, platformAdmin = false } = {}
) {
  return {
    ...options,
    yar: {
      get: (key) => {
        if (signedIn && key === 'user') return { displayName: 'Dev User' }
        if (platformAdmin && key === 'isPlatformAdmin') return true
        return undefined
      }
    }
  }
}

function currentItems(navigation) {
  return navigation.filter((item) => item.current).map((item) => item.text)
}

describe('#buildNavigation', () => {
  test('Should show Models and Help only, with no Home, when signed out', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([
      { text: 'Models', href: '/models', current: false },
      { text: 'Help', href: '/about', current: false }
    ])
  })

  test('Should show Models, Your access, Teams and Help in order when signed in', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/non-existent-path' }, { signedIn: true })
      )
    ).toEqual([
      { text: 'Models', href: '/models', current: false },
      { text: 'Your access', href: '/manage', current: false },
      { text: 'Teams', href: '/teams', current: false },
      { text: 'Help', href: '/about', current: false }
    ])
  })

  test('Should show Admin after Teams, before Help, when a signed in person is a Platform Admin', () => {
    expect(
      buildNavigation(
        mockRequest(
          { path: '/non-existent-path' },
          { signedIn: true, platformAdmin: true }
        )
      )
    ).toEqual([
      { text: 'Models', href: '/models', current: false },
      { text: 'Your access', href: '/manage', current: false },
      { text: 'Teams', href: '/teams', current: false },
      { text: 'Admin', href: '/admin', current: false },
      { text: 'Help', href: '/about', current: false }
    ])
  })

  test.each([
    ['/admin'],
    ['/admin/teams'],
    ['/admin/teams/team-1/members/add']
  ])('Should highlight only Admin for %s', (path) => {
    expect(
      currentItems(
        buildNavigation(
          mockRequest({ path }, { signedIn: true, platformAdmin: true })
        )
      )
    ).toEqual(['Admin'])
  })

  test('Should not show Admin to a signed out person, whatever the session holds', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/admin' }, { platformAdmin: true })
      ).map((item) => item.text)
    ).toEqual(['Models', 'Help'])
  })

  test.each([
    ['/models', 'Models'],
    ['/models/gpt-4o', 'Models'],
    ['/manage', 'Your access'],
    ['/manage/credentials/1/revoke', 'Your access'],
    ['/teams', 'Teams'],
    ['/teams/flood-risk-mapping', 'Teams'],
    ['/teams/flood-risk-mapping/members', 'Teams'],
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

  test('Should not show Teams or Your access to a signed out person on a teams address', () => {
    const navigation = buildNavigation(mockRequest({ path: '/teams' }))

    expect(navigation.map((item) => item.text)).toEqual(['Models', 'Help'])
    expect(currentItems(navigation)).toEqual([])
  })

  test('Should cope with a request that has no path', () => {
    expect(
      currentItems(buildNavigation(mockRequest({}, { signedIn: true })))
    ).toEqual([])
  })
})

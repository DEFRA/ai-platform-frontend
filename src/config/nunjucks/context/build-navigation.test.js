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
  test('Should show Home, Model catalogue and Help when signed out', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([
      { text: 'Home', href: '/', current: false },
      { text: 'Model catalogue', href: '/models', current: false },
      { text: 'Help', href: '/about', current: false }
    ])
  })

  test('Should show Home, Model catalogue, Personal access, Teams, Environments, Usage and Help in order when signed in', () => {
    expect(
      buildNavigation(
        mockRequest({ path: '/non-existent-path' }, { signedIn: true })
      )
    ).toEqual([
      { text: 'Home', href: '/', current: false },
      { text: 'Model catalogue', href: '/models', current: false },
      { text: 'Personal access', href: '/manage', current: false },
      { text: 'Teams', href: '/teams', current: false },
      { text: 'Environments', href: '/environments', current: false },
      { text: 'Usage', href: '/usage', current: false },
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
      { text: 'Home', href: '/', current: false },
      { text: 'Model catalogue', href: '/models', current: false },
      { text: 'Personal access', href: '/manage', current: false },
      { text: 'Teams', href: '/teams', current: false },
      { text: 'Environments', href: '/environments', current: false },
      { text: 'Usage', href: '/usage', current: false },
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
    ).toEqual(['Home', 'Model catalogue', 'Help'])
  })

  test.each([
    ['/', 'Home'],
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
    ['/usage', 'Usage'],
    ['/usage/flood-risk-mapping/costs', 'Usage'],
    ['/about', 'Help']
  ])('Should highlight only the item for %s when signed in', (path, text) => {
    expect(
      currentItems(buildNavigation(mockRequest({ path }, { signedIn: true })))
    ).toEqual([text])
  })

  test('Should highlight Home alone on the home page, not every address', () => {
    expect(currentItems(buildNavigation(mockRequest({ path: '/' })))).toEqual([
      'Home'
    ])
  })

  test('Should not show Personal access, Teams or Environments to a signed out person on a teams address', () => {
    const navigation = buildNavigation(mockRequest({ path: '/teams' }))

    expect(navigation.map((item) => item.text)).toEqual([
      'Home',
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

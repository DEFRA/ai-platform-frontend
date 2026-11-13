import {
  applicationUrl,
  federateProgressUrl,
  federateUrl
} from '#/server/routes/environments/federation-urls.js'

describe('#federateUrl', () => {
  test('is the team’s first question by default', () => {
    expect(federateUrl('flood-risk-team')).toBe(
      '/environments/flood-risk-team/federate'
    )
  })

  test('names a step', () => {
    expect(federateUrl('flood-risk-team', 'service')).toBe(
      '/environments/flood-risk-team/federate/service'
    )
  })

  test('carries the environment it starts from, and a return to check answers', () => {
    expect(
      federateUrl('flood-risk-team', 'name', {
        environment: 'infradev',
        change: true
      })
    ).toBe(
      '/environments/flood-risk-team/federate/name?environment=infradev&change=check'
    )
  })

  test('encodes the team', () => {
    expect(federateUrl('a b')).toBe('/environments/a%20b/federate')
  })
})

describe('#federateProgressUrl', () => {
  test('is the address of the page that follows one federation, by its id', () => {
    expect(federateProgressUrl('flood-risk-team', 'a b')).toBe(
      '/environments/flood-risk-team/federate/progress/a%20b'
    )
  })
})

describe('#applicationUrl', () => {
  test('is the environment’s address for one application and an action', () => {
    expect(
      applicationUrl('flood-risk-team', 'infradev', 'app 1', 'remove')
    ).toBe('/environments/flood-risk-team/infradev/applications/app%201/remove')
  })
})

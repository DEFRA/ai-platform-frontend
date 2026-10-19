import { errorMessageForCode } from './team-client-secret.js'

describe('team-client-secret', () => {
  test.each([
    ['deployment-exists', 'Your team already has one of these models.'],
    [
      'model-not-eligible',
      'One of these models is not available for your team.'
    ],
    [
      'model-not-granted',
      'Your team does not have access to one of these models.'
    ],
    ['environment-not-available', 'This environment is not available yet.'],
    [
      'gateway-not-enabled',
      'Team client secrets are not available in this environment yet.'
    ]
  ])('explains %s in plain words', (code, message) => {
    expect(errorMessageForCode({ code, message: 'raw' })).toBe(message)
  })

  test('passes the backend message through for a code it has no copy for', () => {
    expect(errorMessageForCode({ code: 'something-new', message: 'raw' })).toBe(
      'raw'
    )
  })
})

import { errorMessageForCode } from './team-client-secret.js'

describe('team-client-secret', () => {
  test.each([
    [
      'deployment-exists',
      'A deployment for this team and model already exists.'
    ],
    ['model-not-eligible', 'This model is not available for your team.'],
    ['model-not-granted', 'Your team does not have access to this model.'],
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

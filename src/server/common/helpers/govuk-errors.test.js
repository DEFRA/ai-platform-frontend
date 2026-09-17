import { buildErrorSummary, buildFieldErrors } from './govuk-errors.js'

describe('#govuk-errors', () => {
  const error = {
    details: [
      { message: 'Enter your email address', path: ['email'] },
      { message: 'Enter your name', path: ['displayName'] }
    ]
  }

  test('buildErrorSummary maps Joi details to GOV.UK error summary items', () => {
    expect(buildErrorSummary(error)).toEqual([
      { text: 'Enter your email address', href: '#email' },
      { text: 'Enter your name', href: '#displayName' }
    ])
  })

  test('buildFieldErrors maps Joi details to a field-keyed error object', () => {
    expect(buildFieldErrors(error)).toEqual({
      email: { text: 'Enter your email address' },
      displayName: { text: 'Enter your name' }
    })
  })
})

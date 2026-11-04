import { config } from '#/config/config.js'
import {
  allowedEmailDomains,
  isEligibleAccount
} from './sign-in-eligibility.js'

describe('#sign-in-eligibility', () => {
  describe('the domains that are allowed', () => {
    test('are defra.gov.uk and defra.onmicrosoft.com by default', () => {
      expect(allowedEmailDomains()).toEqual([
        'defra.gov.uk',
        'defra.onmicrosoft.com'
      ])
    })

    describe('when set', () => {
      const original = config.get('allowedEmailDomains')

      afterEach(() => {
        config.set('allowedEmailDomains', original)
      })

      test('are the comma-separated list, trimmed and in lower case, without blanks', () => {
        config.set('allowedEmailDomains', ' Defra.GOV.uk, ,example.org,')

        expect(allowedEmailDomains()).toEqual(['defra.gov.uk', 'example.org'])
      })

      test('allow no one when the list is empty', () => {
        config.set('allowedEmailDomains', ' , ')

        expect(isEligibleAccount({ email: 'a@defra.gov.uk' })).toBe(false)
      })
    })
  })

  describe('an account that is eligible', () => {
    test.each([
      ['a defra.gov.uk email', { email: 'sam.carter@defra.gov.uk' }],
      ['a defra.onmicrosoft.com email', { email: 'sam@defra.onmicrosoft.com' }],
      ['an upper-case domain', { email: 'Sam.Carter@DEFRA.GOV.UK' }],
      [
        'a mixed-case onmicrosoft domain',
        { email: 'sam@Defra.OnMicrosoft.com' }
      ],
      [
        'no email but a defra.onmicrosoft.com user name',
        { preferredUsername: 'sam@defra.onmicrosoft.com' }
      ],
      [
        'an email with a user name on the same domain',
        {
          email: 'sam@defra.gov.uk',
          preferredUsername: 'sam@defra.onmicrosoft.com'
        }
      ]
    ])('has %s', (_name, claims) => {
      expect(isEligibleAccount(claims)).toBe(true)
    })
  })

  describe('an account that is not eligible', () => {
    test.each([
      [
        'a guest user name (#EXT#)',
        { preferredUsername: 'sam_gmail.com#EXT#@defra.onmicrosoft.com' }
      ],
      [
        'a guest user name in lower case (#ext#)',
        { preferredUsername: 'sam_gmail.com#ext#@defra.onmicrosoft.com' }
      ],
      [
        'a Defra email but a guest user name',
        {
          email: 'sam@defra.gov.uk',
          preferredUsername: 'sam_defra.gov.uk#EXT#@defra.onmicrosoft.com'
        }
      ],
      ['a guest email', { email: 'sam_gmail.com#EXT#@defra.onmicrosoft.com' }],
      ['a subdomain of defra.gov.uk', { email: 'sam@sub.defra.gov.uk' }],
      [
        'a subdomain of defra.onmicrosoft.com',
        { email: 'sam@sub.defra.onmicrosoft.com' }
      ],
      [
        'defra.gov.uk at the start of another domain',
        { email: 'sam@defra.gov.uk.example.com' }
      ],
      [
        'defra.onmicrosoft.com at the start of another domain',
        { email: 'sam@defra.onmicrosoft.com.evil.com' }
      ],
      [
        'a domain that only ends like Defra’s',
        { email: 'sam@notdefra.gov.uk' }
      ],
      ['another domain', { email: 'sam@example.com' }],
      [
        'a second @ with Defra’s domain last',
        { email: 'sam@example.com@defra.gov.uk' }
      ],
      [
        'a second @ with Defra’s domain first',
        { email: 'sam@defra.gov.uk@example.com' }
      ],
      ['no user name before the @', { email: '@defra.gov.uk' }],
      ['no @', { email: 'defra.gov.uk' }],
      ['an empty email', { email: '' }],
      ['no email and no user name', {}],
      ['a look-alike domain (Cyrillic а)', { email: 'sam@defrа.gov.uk' }],
      ['a space in the domain', { email: 'sam@defra.gov.uk .example.com' }],
      ['an email that is not text', { email: 42 }]
    ])('has %s', (_name, claims) => {
      expect(isEligibleAccount(claims)).toBe(false)
    })
  })
})

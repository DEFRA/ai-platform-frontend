import { config } from '#/config/config.js'
import {
  allowedEmailDomains,
  isEligibleAccount,
  signInAddress
} from './sign-in-eligibility.js'

// The tenant Defra signs people in to, as an ID token carries it: `tid` is the
// tenant of the resource, and a v2.0 `iss` is `login.microsoftonline.com/{tid}/v2.0`.
const TID = '7a1d2b3c-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const HOME_TID = '3c9d8e7f-1a2b-4c3d-9e4f-5a6b7c8d9e0f'
const ISS = `https://login.microsoftonline.com/${TID}/v2.0`

// A member of the tenant, as Entra sends the token (profile and email scopes).
function member(overrides = {}) {
  return {
    iss: ISS,
    tid: TID,
    oid: '0f8fad5b-d9cb-469f-a165-70867728950e',
    preferred_username: 'sam.carter@defra.gov.uk',
    email: 'sam.carter@defra.gov.uk',
    name: 'Sam Carter',
    ...overrides
  }
}

// A B2B guest, as Entra sends the token: the user name is the home one, the
// `#EXT#` name only in `upn` (if asked for), `idp` is the home provider, and
// `tid` is still the resource tenant.
function guest(overrides = {}) {
  return member({
    idp: `https://sts.windows.net/${HOME_TID}/`,
    ...overrides
  })
}

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

        expect(isEligibleAccount(member())).toBe(false)
      })
    })
  })

  describe('an account that is eligible', () => {
    test.each([
      ['a member on defra.gov.uk', member()],
      [
        'a member on defra.onmicrosoft.com',
        member({
          preferred_username: 'sam@defra.onmicrosoft.com',
          email: 'sam@defra.onmicrosoft.com'
        })
      ],
      [
        'upper-case domains',
        member({
          preferred_username: 'Sam@DEFRA.GOV.UK',
          email: 'Sam@Defra.OnMicrosoft.com'
        })
      ],
      ['no email claim', member({ email: undefined })],
      ['a blank email claim', member({ email: '  ' })],
      [
        'a user name on one allowed domain and an email on the other',
        member({
          preferred_username: 'sam@defra.onmicrosoft.com',
          email: 'sam@defra.gov.uk'
        })
      ],
      [
        'a upn with no preferred_username',
        member({
          preferred_username: undefined,
          upn: 'sam@defra.onmicrosoft.com'
        })
      ],
      ['acct 0 (a member)', member({ acct: 0 })],
      ['acct "0"', member({ acct: '0' })],
      ['an idp that is the issuer', member({ idp: ISS })],
      [
        'an idp that is this tenant’s STS address',
        member({ idp: `https://sts.windows.net/${TID}/` })
      ],
      [
        'an idp in upper case for this tenant',
        member({ idp: `https://sts.windows.net/${TID.toUpperCase()}/` })
      ]
    ])('has %s', (_name, claims) => {
      expect(isEligibleAccount(claims)).toBe(true)
    })
  })

  describe('a guest', () => {
    test.each([
      ['a B2B guest of another tenant (idp is the home tenant)', guest()],
      [
        'a guest whose home tenant is on login.microsoftonline.com',
        guest({ idp: `https://login.microsoftonline.com/${HOME_TID}/v2.0` })
      ],
      [
        'a guest with a personal Microsoft account (idp live.com)',
        guest({ idp: 'live.com' })
      ],
      [
        'a guest with a Google account (idp google.com)',
        guest({ idp: 'google.com' })
      ],
      ['a guest with an idp when tid is missing', guest({ tid: undefined })],
      ['a guest whose idp is not text', guest({ idp: 42 })],
      ['a guest whose idp is empty', guest({ idp: '' })],
      ['a guest by acct 1', member({ acct: 1 })],
      ['a guest by acct "1"', member({ acct: '1' })],
      [
        'a guest by the #EXT# upn, with a home user name and no idp',
        member({
          upn: 'sam.carter_defra.gov.uk#EXT#@defra.onmicrosoft.com'
        })
      ],
      [
        'a guest by the #EXT# user name',
        member({
          preferred_username: 'sam_gmail.com#EXT#@defra.onmicrosoft.com',
          email: undefined
        })
      ],
      [
        'a guest by the #EXT# email',
        member({ email: 'sam_defra.gov.uk#ext#@defra.onmicrosoft.com' })
      ],
      [
        'a guest with a home user name on another tenant and a Defra email',
        member({
          preferred_username: 'sam@othertenant.example',
          email: 'sam.carter@defra.gov.uk'
        })
      ]
    ])('is not eligible: %s', (_name, claims) => {
      expect(isEligibleAccount(claims)).toBe(false)
    })
  })

  describe('an account that is not eligible by its address', () => {
    test.each([
      [
        'a subdomain of defra.gov.uk',
        member({ preferred_username: 'sam@sub.defra.gov.uk' })
      ],
      [
        'a look-alike of defra.onmicrosoft.com',
        member({ preferred_username: 'sam@defra.onmicrosoft.com.evil.com' })
      ],
      ['another domain', member({ preferred_username: 'sam@example.com' })],
      [
        'a Defra user name but an email on another domain',
        member({ email: 'sam@example.com' })
      ],
      [
        'a Defra user name but a look-alike email',
        member({ email: 'sam@defra.gov.uk.example.com' })
      ],
      [
        'a Defra user name but a upn on another domain',
        member({ upn: 'sam@example.com' })
      ],
      [
        'an email only, with no user name',
        member({ preferred_username: undefined })
      ],
      ['no claims about the person', {}],
      ['an email that is not text', member({ email: 42 })]
    ])('has %s', (_name, claims) => {
      expect(isEligibleAccount(claims)).toBe(false)
    })
  })

  describe('the address sent to the backend', () => {
    test.each([
      ['the email when there is one', member(), 'sam.carter@defra.gov.uk'],
      [
        'the email, trimmed',
        member({ email: ' Sam@Defra.gov.uk ' }),
        'Sam@Defra.gov.uk'
      ],
      [
        'the user name when the email is blank',
        member({ email: ' ', preferred_username: 'sam@defra.onmicrosoft.com' }),
        'sam@defra.onmicrosoft.com'
      ],
      [
        'the user name when there is no email',
        member({ email: undefined }),
        'sam.carter@defra.gov.uk'
      ],
      [
        'the upn when there is neither',
        member({
          email: undefined,
          preferred_username: undefined,
          upn: 'sam@defra.onmicrosoft.com'
        }),
        'sam@defra.onmicrosoft.com'
      ]
    ])('is %s', (_name, claims, expected) => {
      expect(signInAddress(claims)).toBe(expected)
    })
  })
})

import { isEligible } from './eligibility-rule.js'

// The shared rule table. The backend runs the same table against its
// `isEligible` (src/services/directory-eligibility.test.js); change one, change
// the other, so the two sides keep deciding alike.
const DOMAINS = ['defra.gov.uk', 'defra.onmicrosoft.com']

const ACCEPTED = [
  ['a defra.gov.uk name', 'ada@defra.gov.uk', undefined],
  ['a defra.onmicrosoft.com name', 'ada@defra.onmicrosoft.com', null],
  ['an upper-case name', 'ADA@DEFRA.GOV.UK', undefined],
  ['a padded name', '  ada@defra.gov.uk\t', undefined],
  [
    'a name and a mail on allowed domains',
    'ada@defra.onmicrosoft.com',
    'Ada@Defra.gov.uk'
  ],
  ['an empty mail, as no mail', 'ada@defra.gov.uk', ''],
  ['a blank mail, as no mail', 'ada@defra.gov.uk', ' \t\n']
]

const REFUSED = [
  ['a subdomain', 'ada@sub.defra.gov.uk', undefined],
  ['a look-alike suffix', 'ada@defra.gov.uk.example.com', undefined],
  ['a look-alike prefix', 'ada@notdefra.gov.uk', undefined],
  ['a trailing dot', 'ada@defra.gov.uk.', undefined],
  ['a guest name', 'ada_example.com#EXT#@defra.onmicrosoft.com', undefined],
  [
    'a guest name in lower case',
    'ada_example.com#ext#@defra.onmicrosoft.com',
    undefined
  ],
  [
    'a guest mail',
    'ada@defra.gov.uk',
    'ada_example.com#EXT#@defra.onmicrosoft.com'
  ],
  ['another domain', 'ada@example.com', undefined],
  ['a mail on another domain', 'ada@defra.gov.uk', 'ada@example.com'],
  ['a second @, Defra last', 'ada@example.com@defra.gov.uk', undefined],
  ['a second @, Defra first', 'ada@defra.gov.uk@example.com', undefined],
  ['no local part', '@defra.gov.uk', undefined],
  ['no @', 'defra.gov.uk', undefined],
  ['an empty name', '', undefined],
  ['no name', undefined, undefined],
  ['a name that is not text', 42, undefined],
  ['a mail that is not text', 'ada@defra.gov.uk', 42],
  ['a Cyrillic look-alike', 'ada@defrа.gov.uk', undefined],
  ['a space in the domain', 'ada@defra.gov.uk .example.com', undefined]
]

describe('#eligibility-rule (the shared rule)', () => {
  test.each(ACCEPTED)('accepts %s', (_name, userPrincipalName, mail) => {
    expect(isEligible({ userPrincipalName, mail }, DOMAINS)).toBe(true)
  })

  test.each(REFUSED)('refuses %s', (_name, userPrincipalName, mail) => {
    expect(isEligible({ userPrincipalName, mail }, DOMAINS)).toBe(false)
  })

  test('refuses everyone when no domain is allowed', () => {
    expect(isEligible({ userPrincipalName: 'ada@defra.gov.uk' }, [])).toBe(
      false
    )
  })

  test('ignores blank and padded entries in the domain list', () => {
    expect(
      isEligible({ userPrincipalName: 'ada@defra.gov.uk' }, [
        ' DEFRA.gov.uk ',
        ''
      ])
    ).toBe(true)
  })

  test('refuses a missing person', () => {
    expect(isEligible(null, DOMAINS)).toBe(false)
  })
})

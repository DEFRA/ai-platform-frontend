import {
  auditFormQuery,
  auditUrl,
  FORM_ANCHOR,
  readAuditQuery,
  MAX_PERSON_LENGTH
} from './audit-query.js'

function api(query) {
  return readAuditQuery(query).apiQuery
}

describe('#readAuditQuery', () => {
  test('Should ask for everything when nothing is filtered', () => {
    const { apiQuery, errors, filters } = readAuditQuery({})

    expect(apiQuery).toBe('')
    expect(errors).toBeNull()
    expect(filters.person).toBe('')
    expect(filters.from).toEqual({ day: '', month: '', year: '' })
  })

  test('Should pass each filter on, trimmed, and nothing else', () => {
    expect(
      api({
        team: ' team-1 ',
        environment: 'infradev',
        person: '  Jo Smith ',
        action: 'team.create',
        actorType: 'team-admin',
        page: '2',
        other: 'x'
      })
    ).toBe(
      'team=team-1&environment=infradev&person=Jo+Smith&action=team.create&actorType=team-admin&page=2'
    )
  })

  test('Should leave out what is empty, blank or not a single value', () => {
    expect(
      api({ team: '', environment: ['a', 'b'], person: '   ', page: ' ' })
    ).toBe('')
  })

  test('Should turn the UK days into the first and last instants of the days, as UTC', () => {
    expect(
      api({
        'from-day': '29',
        'from-month': '3',
        'from-year': '2026',
        'to-day': '25',
        'to-month': '10',
        'to-year': '2026'
      })
    ).toBe(
      `from=${encodeURIComponent('2026-03-29T00:00:00.000Z')}&to=${encodeURIComponent('2026-10-25T23:59:59.999Z')}`
    )
  })

  test('Should take one end of the range alone, and the same day for both', () => {
    expect(api({ 'to-day': '1', 'to-month': '7', 'to-year': '2026' })).toBe(
      `to=${encodeURIComponent('2026-07-01T22:59:59.999Z')}`
    )
    expect(
      api({
        'from-day': '1',
        'from-month': '7',
        'from-year': '2026',
        'to-day': '1',
        'to-month': '7',
        'to-year': '2026'
      })
    ).toContain('from=')
  })

  test('Should keep what was typed, for the form to show again', () => {
    const { filters } = readAuditQuery({
      team: 't',
      person: ' Jo ',
      'from-day': '01',
      'from-month': '7',
      'from-year': '2026'
    })

    expect(filters.team).toBe('t')
    expect(filters.person).toBe('Jo')
    expect(filters.from).toEqual({ day: '01', month: '7', year: '2026' })
  })

  describe('errors', () => {
    test.each([['a'], ['x'.repeat(MAX_PERSON_LENGTH + 1)]])(
      'Should refuse a person of the wrong length (%#) on the Person field, with no API query',
      (person) => {
        const { apiQuery, errors } = readAuditQuery({ person })

        expect(apiQuery).toBeNull()
        expect(errors.errorSummary).toEqual([
          { text: 'Person must be 2 to 100 characters', href: '#person' }
        ])
        expect(errors.fieldErrors.person.text).toBe(
          'Person must be 2 to 100 characters'
        )
      }
    )

    test('Should accept a person of 2 and of 100 characters', () => {
      expect(readAuditQuery({ person: 'Jo' }).errors).toBeNull()
      expect(
        readAuditQuery({ person: 'x'.repeat(MAX_PERSON_LENGTH) }).errors
      ).toBeNull()
    })

    test.each([
      [{ 'from-day': '1' }, 'From date must include a month and year'],
      [{ 'from-month': '1' }, 'From date must include a day and year'],
      [{ 'from-year': '2026' }, 'From date must include a day and month'],
      [{ 'from-day': '1', 'from-month': '2' }, 'From date must include a year'],
      [
        { 'from-month': '2', 'from-year': '2026' },
        'From date must include a day'
      ],
      [
        { 'from-day': '1', 'from-year': '2026' },
        'From date must include a month'
      ]
    ])('Should say what an incomplete date lacks (%j)', (query, text) => {
      const { errors } = readAuditQuery(query)

      expect(errors.errorSummary[0].text).toBe(text)
      expect(errors.fieldErrors.from.text).toBe(text)
    })

    test('Should point the incomplete date’s link at the first part that is missing, and mark only the missing parts', () => {
      const { errors } = readAuditQuery({ 'to-day': '1', 'to-year': '2026' })

      expect(errors.errorSummary).toEqual([
        { text: 'To date must include a month', href: '#to-month' }
      ])
      expect(errors.dateErrors.to).toEqual(['month'])
    })

    test.each([
      [{ day: '31', month: '4', year: '2026' }],
      [{ day: '29', month: '2', year: '2026' }],
      [{ day: '0', month: '1', year: '2026' }],
      [{ day: '1', month: '13', year: '2026' }],
      [{ day: 'ab', month: '1', year: '2026' }],
      [{ day: '1', month: '1', year: '26' }],
      [{ day: '1.5', month: '1', year: '2026' }]
    ])('Should say a date that is not real is not real (%j)', (parts) => {
      const { errors } = readAuditQuery({
        'to-day': parts.day,
        'to-month': parts.month,
        'to-year': parts.year
      })

      expect(errors.errorSummary[0]).toEqual({
        text: 'To date must be a real date',
        href: '#to-day'
      })
      expect(errors.dateErrors.to).toEqual(['day', 'month', 'year'])
    })

    test('Should accept 29 February in a leap year', () => {
      expect(
        readAuditQuery({
          'to-day': '29',
          'to-month': '2',
          'to-year': '2028'
        }).errors
      ).toBeNull()
    })

    test('Should refuse From after To, on the To field, but allow the same day', () => {
      const { apiQuery, errors } = readAuditQuery({
        'from-day': '2',
        'from-month': '7',
        'from-year': '2026',
        'to-day': '1',
        'to-month': '7',
        'to-year': '2026'
      })

      expect(apiQuery).toBeNull()
      expect(errors.errorSummary).toEqual([
        {
          text: 'To date must be the same as or after the From date',
          href: '#to-day'
        }
      ])
      expect(errors.dateErrors.to).toEqual(['day', 'month', 'year'])
    })

    test.each([['0'], ['abc'], ['-1'], ['1.5']])(
      'Should say the page number is wrong when page is %s, linking to the form, not a field that is fine',
      (page) => {
        const { errors } = readAuditQuery({ page })

        expect(errors.errorSummary[0].text).toContain(
          'The page number must be a whole number'
        )
        expect(errors.errorSummary[0].href).toBe(FORM_ANCHOR)
        expect(errors.fieldErrors).toEqual({})
      }
    )

    test.each([
      ['team', 'x'.repeat(101), 'Choose a team from the list'],
      ['environment', 'Not Valid', 'Choose an environment from the list'],
      ['environment', 'e'.repeat(41), 'Choose an environment from the list'],
      ['action', 'noDot', 'Choose an action from the list'],
      ['action', 'a.b.c.d.e', 'Choose an action from the list'],
      ['action', `a.${'b'.repeat(64)}`, 'Choose an action from the list'],
      ['actorType', 'robot', 'Choose an actor type from the list']
    ])(
      'Should refuse a %s the backend would refuse (%j), on its own field',
      (field, value, text) => {
        const { apiQuery, errors } = readAuditQuery({ [field]: value })

        expect(apiQuery).toBeNull()
        expect(errors.errorSummary).toEqual([{ text, href: `#${field}` }])
        expect(errors.fieldErrors[field].text).toBe(text)
      }
    )

    test.each([
      ['team', 'x'.repeat(100)],
      ['environment', 'infradev'],
      ['action', 'team.setMemberRole'],
      ['action', 'admin.credentials.disable']
    ])('Should let a %s the backend accepts through (%s)', (field, value) => {
      expect(readAuditQuery({ [field]: value }).errors).toBeNull()
    })

    test('Should list every error, in the order of the form', () => {
      const { errors } = readAuditQuery({
        page: '0',
        'to-day': '1',
        person: 'a',
        actorType: 'robot',
        team: 'x'.repeat(101)
      })

      expect(errors.errorSummary.map(({ href }) => href)).toEqual([
        '#team',
        '#actorType',
        '#person',
        '#to-month',
        FORM_ANCHOR
      ])
    })
  })
})

describe('#auditUrl', () => {
  test('Should be the page itself with no filters on the first page', () => {
    expect(auditUrl({})).toBe('/admin/audit')
  })

  test('Should carry the filters as typed, encoded, and the page after the first', () => {
    const { filters } = readAuditQuery({
      team: 'team 1',
      person: 'a&b',
      'from-day': '1',
      'from-month': '7',
      'from-year': '2026'
    })

    expect(auditUrl(filters, 3)).toBe(
      '/admin/audit?team=team+1&person=a%26b&from-day=1&from-month=7&from-year=2026&page=3'
    )
    expect(auditUrl(filters, 1)).not.toContain('page=')
  })
})

describe('#auditFormQuery', () => {
  test('Should give the filters as the form field names', () => {
    const { filters } = readAuditQuery({
      action: 'team.create',
      'to-day': '1',
      'to-month': '2',
      'to-year': '2026'
    })

    expect(auditFormQuery(filters)).toEqual({
      action: 'team.create',
      'to-day': '1',
      'to-month': '2',
      'to-year': '2026'
    })
  })
})

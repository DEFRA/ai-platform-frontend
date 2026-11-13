import {
  CREDENTIAL_FILTERS,
  credentialHeld,
  credentialStatus,
  credentialTag,
  modelStatusTag,
  STATUS_FILTERS,
  statusTag
} from './deployment-labels.js'

describe('#statusTag', () => {
  test.each([
    ['ready', 'Ready', 'govuk-tag--green'],
    ['setting-up', 'Setting up', 'govuk-tag--yellow'],
    ['waiting', 'Waiting', 'govuk-tag--grey'],
    ['removing', 'Removing', 'govuk-tag--yellow'],
    ['needs-attention', 'Needs attention', 'govuk-tag--red']
  ])(
    'says %s in words, with a colour that only helps',
    (status, text, classes) => {
      expect(statusTag(status)).toEqual({ text, classes })
    }
  )

  test('reads a status the page does not know as unknown, never as progress', () => {
    expect(statusTag('brand-new')).toEqual({
      text: 'Status unknown',
      classes: 'govuk-tag--grey'
    })
  })

  test('is the same set of choices the filter offers, after "All statuses"', () => {
    expect(STATUS_FILTERS.map(({ value }) => value)).toEqual([
      '',
      'ready',
      'setting-up',
      'waiting',
      'removing',
      'needs-attention'
    ])
    expect(STATUS_FILTERS[0].text).toBe('All statuses')
  })
})

describe('#credentialTag', () => {
  test.each([
    ['active', 'Active'],
    ['disabled', 'Disabled'],
    ['revoked', 'Revoked'],
    ['none', 'None']
  ])('says %s as %s', (status, text) => {
    expect(credentialTag(status).text).toBe(text)
  })

  test('says a status it does not know as it is, in grey', () => {
    expect(credentialTag('odd')).toEqual({
      text: 'odd',
      classes: 'govuk-tag--grey'
    })
  })

  test('offers the same choices to the filter', () => {
    expect(CREDENTIAL_FILTERS.map(({ value }) => value)).toEqual([
      '',
      'active',
      'disabled',
      'revoked',
      'none'
    ])
  })
})

describe('#credentialStatus', () => {
  test('reads a status given as a word or as an object with a status', () => {
    expect(credentialStatus('active')).toBe('active')
    expect(credentialStatus({ status: 'disabled', blockedAt: 'x' })).toBe(
      'disabled'
    )
  })

  test('reads nothing as none', () => {
    expect(credentialStatus(undefined)).toBe('none')
    expect(credentialStatus(null)).toBe('none')
  })
})

describe('#credentialHeld', () => {
  test('is the status itself when nothing is under a block', () => {
    expect(credentialHeld('active')).toBe('active')
    expect(credentialHeld({ status: 'revoked' })).toBe('revoked')
    expect(credentialHeld(null)).toBe('none')
  })

  test.each(['active', 'revoked', 'none'])(
    'is what the backend says is under a block: %s',
    (held) => {
      expect(credentialHeld({ status: 'disabled', held })).toBe(held)
    }
  )

  test('is unknown for a block the backend did not say what is under', () => {
    expect(credentialHeld({ status: 'disabled' })).toBe('unknown')
    expect(credentialHeld({ status: 'disabled', held: 7 })).toBe('unknown')
  })
})

describe('#modelStatusTag', () => {
  test('uses the words the team pages use for a deployment state', () => {
    expect(modelStatusTag('active')).toEqual({
      text: 'Ready to use',
      classes: 'govuk-tag--green'
    })
    expect(modelStatusTag('timed-out').text).toBe('Setup failed')
  })
})

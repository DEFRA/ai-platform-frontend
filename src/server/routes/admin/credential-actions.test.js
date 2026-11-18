import {
  CREDENTIAL_ACTIONS,
  credentialIn,
  environmentChoices,
  isDone,
  isOffered,
  OFFERED,
  readEnvironments,
  resolveEnvironments
} from './credential-actions.js'

describe('#isOffered', () => {
  test.each([
    ['disable', 'active', true],
    ['disable', 'disabled', false],
    ['disable', 'revoked', true],
    ['disable', 'none', true],
    ['enable', 'active', false],
    ['enable', 'disabled', true],
    ['enable', 'revoked', false],
    ['enable', 'none', false]
  ])(
    '%s in an environment whose credential is %s: %s',
    (action, status, expected) => {
      expect(isOffered(action, status)).toBe(expected)
    }
  )

  test('offers nothing for an action it does not know, including the removed whole-environment revoke', () => {
    expect(isOffered('delete', 'active')).toBe(false)
    expect(isOffered('revoke', 'active')).toBe(false)
  })

  test('Disable and Enable follow the block, whatever is under it', () => {
    expect(isOffered('enable', { status: 'disabled', held: 'revoked' })).toBe(
      true
    )
    expect(isOffered('disable', { status: 'disabled', held: 'active' })).toBe(
      false
    )
  })

  test('lists the actions in the order the buttons show', () => {
    expect(OFFERED).toEqual(['disable', 'enable'])
  })
})

describe('#isDone', () => {
  test.each([
    ['disable', 'disabled', true],
    ['disable', 'active', false],
    ['enable', 'active', false],
    ['revoke', 'revoked', false]
  ])('%s, credential %j: %s', (action, credential, expected) => {
    expect(isDone(action, credential)).toBe(expected)
  })
})

describe('#CREDENTIAL_ACTIONS', () => {
  test('has Disable and Enable only', () => {
    expect(Object.keys(CREDENTIAL_ACTIONS)).toEqual(['disable', 'enable'])
  })

  test('asks for a reason to disable, and not to enable', () => {
    expect(CREDENTIAL_ACTIONS.disable.needsReason).toBe(true)
    expect(CREDENTIAL_ACTIONS.enable.needsReason).toBe(false)
  })

  test('says what is true for Disable, calls stopping within 60 seconds, and that the team is not told why', () => {
    expect(CREDENTIAL_ACTIONS.disable.effect).toBe(
      'Calls using the team’s credentials in these environments stop within 60 seconds. The team cannot create new credentials or view or rotate its secrets there. The team is not told why.'
    )
  })

  test('has a secondary button to disable and a plain one to enable', () => {
    expect(CREDENTIAL_ACTIONS.disable.buttonClasses).toBe(
      'govuk-button--secondary'
    )
    expect(CREDENTIAL_ACTIONS.enable.buttonClasses).toBe('')
  })
})

const deployment = {
  environment: 'infradev',
  credential: { status: 'active' },
  environments: [
    { environment: 'infradev', credential: { status: 'active' } },
    { environment: 'qa', credential: { status: 'disabled', held: 'active' } },
    { environment: 'prod', credential: { status: 'revoked' } },
    { environment: 'preprod', credential: 'none' }
  ]
}

describe('#environmentChoices', () => {
  test('lists the environments the action is offered for, the current one ticked', () => {
    expect(
      environmentChoices('disable', deployment, ['infradev']).map(
        ({ value, text, checked }) => ({ value, text, checked })
      )
    ).toEqual([
      { value: 'infradev', text: 'Development', checked: true },
      { value: 'prod', text: 'Production', checked: false },
      { value: 'preprod', text: 'Pre-production', checked: false }
    ])
  })

  test('says why Disable is still offered for a revoked or missing credential', () => {
    const items = environmentChoices('disable', deployment, [])

    expect(items.find(({ value }) => value === 'prod').hint.text).toBe(
      'Its credential is revoked. Disabling stops a new one being created.'
    )
    expect(items.find(({ value }) => value === 'preprod').hint.text).toBe(
      'It has no credential yet. Disabling stops one being created.'
    )
    expect(items.find(({ value }) => value === 'infradev').hint).toBeUndefined()
  })

  test('reads an environment’s credential from the list, and none for one the team lacks', () => {
    expect(credentialIn(deployment, 'qa')).toEqual({
      status: 'disabled',
      held: 'active'
    })
    expect(credentialIn(deployment, 'nowhere')).toBeNull()
  })

  test('lists for Enable only the environments that are disabled', () => {
    expect(
      environmentChoices('enable', deployment, ['qa']).map(
        ({ value, checked }) => ({ value, checked })
      )
    ).toEqual([{ value: 'qa', checked: true }])
  })

  test('reads the current environment’s state from the page’s own credential when the list has no entry', () => {
    expect(
      environmentChoices(
        'enable',
        {
          environment: 'infradev',
          credential: { status: 'disabled' },
          environments: []
        },
        []
      ).map(({ value }) => value)
    ).toEqual(['infradev'])
  })
})

describe('#readEnvironments', () => {
  test('reads one, many or none from a form', () => {
    expect(readEnvironments('qa')).toEqual(['qa'])
    expect(readEnvironments(['qa', 'prod', 'qa'])).toEqual(['qa', 'prod'])
    expect(readEnvironments(undefined)).toEqual([])
    expect(readEnvironments({})).toEqual([])
  })

  test('reads a comma list from an address, and ignores blanks and repeats', () => {
    expect(readEnvironments('qa, prod,,qa ')).toEqual(['qa', 'prod'])
  })

  test('ignores what is not text', () => {
    expect(readEnvironments([1, null, 'qa'])).toEqual(['qa'])
  })

  test('keeps no more than ten', () => {
    expect(
      readEnvironments(Array.from({ length: 30 }, (_, index) => `e${index}`))
    ).toHaveLength(10)
  })
})

describe('#resolveEnvironments', () => {
  test('is the environments asked for, when each is offered', () => {
    expect(resolveEnvironments('disable', deployment, ['infradev'])).toEqual({
      environments: ['infradev']
    })
  })

  test('says none were chosen', () => {
    expect(resolveEnvironments('disable', deployment, [])).toEqual({
      problem: 'none'
    })
  })

  test('says an environment the action is not offered for is not on the list', () => {
    expect(resolveEnvironments('enable', deployment, ['infradev'])).toEqual({
      problem: 'not-offered'
    })
  })

  test('says an environment the team does not have is unknown, before anything else', () => {
    expect(
      resolveEnvironments('disable', deployment, ['infradev', 'nowhere'])
    ).toEqual({ problem: 'unknown' })
  })
})

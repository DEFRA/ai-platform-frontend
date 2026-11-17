import {
  carryFormKey,
  credentialKey,
  issueFormKey,
  teamDisableKey
} from './credential-keys.js'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const request = { yar: { id: 'session-1' } }
const operation = {
  action: 'disable',
  teamId: 'team-1',
  environment: 'infradev',
  formKey: issueFormKey(),
  reason: 'Suspected misuse'
}

describe('#credentialKey', () => {
  test('is a version 4 UUID, the shape the backend takes', () => {
    expect(credentialKey(request, operation)).toMatch(UUID_V4)
  })

  test('is the same for a retry of the same form with the same reason', () => {
    expect(credentialKey(request, operation)).toBe(
      credentialKey(request, { ...operation })
    )
  })

  test.each([
    ['action', { action: 'enable' }],
    ['team', { teamId: 'team-2' }],
    ['environment', { environment: 'prod' }],
    ['form', { formKey: issueFormKey() }],
    ['reason', { reason: 'Another reason' }]
  ])('is another key when the %s is another', (_name, change) => {
    expect(credentialKey(request, { ...operation, ...change })).not.toBe(
      credentialKey(request, operation)
    )
  })

  test('is another key for another session', () => {
    expect(credentialKey({ yar: { id: 'session-2' } }, operation)).not.toBe(
      credentialKey(request, operation)
    )
  })
})

describe('#teamDisableKey', () => {
  const disable = {
    teamId: 'team-1',
    formKey: issueFormKey(),
    reason: 'Suspected misuse',
    environments: ['infradev', 'qa']
  }

  test('is a version 4 UUID, the same for a retry of the same form, reason and choice, whatever the order of the environments', () => {
    expect(teamDisableKey(request, disable)).toMatch(UUID_V4)
    expect(teamDisableKey(request, disable)).toBe(
      teamDisableKey(request, { ...disable, environments: ['qa', 'infradev'] })
    )
  })

  test.each([
    ['team', { teamId: 'team-2' }],
    ['form', { formKey: issueFormKey() }],
    ['reason', { reason: 'Another reason' }],
    ['environments', { environments: ['infradev'] }],
    ['choice of none', { environments: [] }]
  ])('is another key when the %s is another', (_name, change) => {
    expect(teamDisableKey(request, { ...disable, ...change })).not.toBe(
      teamDisableKey(request, disable)
    )
  })

  test('is another key for another session, and from a credential key', () => {
    expect(teamDisableKey({ yar: { id: 'session-2' } }, disable)).not.toBe(
      teamDisableKey(request, disable)
    )
    expect(teamDisableKey(request, disable)).not.toBe(
      credentialKey(request, operation)
    )
  })

  test('does not change the order of the list it is given', () => {
    const environments = ['qa', 'infradev']

    teamDisableKey(request, { ...disable, environments })

    expect(environments).toEqual(['qa', 'infradev'])
  })
})

describe('#issueFormKey and #carryFormKey', () => {
  test('issues a UUID, and a different one each time', () => {
    expect(issueFormKey()).toMatch(UUID_V4)
    expect(issueFormKey()).not.toBe(issueFormKey())
  })

  test('carries a UUID the form came with, in lower case', () => {
    const key = issueFormKey()

    expect(carryFormKey(key)).toBe(key)
    expect(carryFormKey(key.toUpperCase())).toBe(key)
  })

  test.each([[undefined], [''], ['not-a-uuid'], [['a']], [42]])(
    'issues a new key when the form came with %j',
    (offered) => {
      expect(carryFormKey(offered)).toMatch(UUID_V4)
    }
  )
})

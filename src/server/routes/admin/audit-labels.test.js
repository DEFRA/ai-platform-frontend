import {
  ACTION_OPTIONS,
  ACTOR_TYPES,
  actionLabel,
  actorTypeLabel,
  outcomeTag
} from './audit-labels.js'

describe('#actionLabel', () => {
  test.each([
    ['user.signIn', 'Signed in'],
    ['team.create', 'Created a team'],
    ['team.setMemberRole', 'Changed a member’s role'],
    ['teamDeployment.request', 'Requested an environment'],
    ['credential.revoke', 'Revoked a credential'],
    ['operation.external', 'Platform operation']
  ])('Should say %s as "%s"', (action, label) => {
    expect(actionLabel({ action, code: null })).toBe(label)
  })

  test.each([
    ['not-a-member', 'Refused: not a member of the team'],
    ['admin-required', 'Refused: Team Admin role needed'],
    ['platform-admin-required', 'Refused: Platform Admin role needed'],
    ['self-add-refused', 'Refused: adding yourself to a team']
  ])('Should say an access refusal for %s as "%s"', (code, label) => {
    expect(actionLabel({ action: 'access.denied', code })).toBe(label)
  })

  test('Should say a refusal with a code it has no words for, with the code', () => {
    expect(actionLabel({ action: 'access.denied', code: 'odd-code' })).toBe(
      'Access refused (odd-code)'
    )
    expect(actionLabel({ action: 'access.denied', code: null })).toBe(
      'Access refused'
    )
  })

  test('Should show the action as it is when it has no label yet', () => {
    expect(
      actionLabel({ action: 'admin.credentials.disable', code: null })
    ).toBe('admin.credentials.disable')
  })
})

describe('#actorTypeLabel', () => {
  test.each([
    ['platform-admin', 'Platform Admin'],
    ['team-admin', 'Team Admin'],
    ['team-member', 'Team member'],
    ['person', 'Person with no team role'],
    ['system', 'System']
  ])('Should say %s as "%s"', (type, label) => {
    expect(actorTypeLabel(type)).toBe(label)
  })

  test('Should show a type it does not know as it is', () => {
    expect(actorTypeLabel('robot')).toBe('robot')
  })

  test('Should offer the five types, in the order the filter shows them', () => {
    expect(ACTOR_TYPES.map(({ value }) => value)).toEqual([
      'platform-admin',
      'team-admin',
      'team-member',
      'person',
      'system'
    ])
  })
})

describe('#outcomeTag', () => {
  test('Should say Done in green, Failed in red and Refused for a refusal', () => {
    expect(outcomeTag({ outcome: 'success', action: 'team.create' })).toEqual({
      text: 'Done',
      classes: 'govuk-tag--green'
    })
    expect(outcomeTag({ outcome: 'failure', action: 'team.create' })).toEqual({
      text: 'Failed',
      classes: 'govuk-tag--red'
    })
    expect(outcomeTag({ outcome: 'failure', action: 'access.denied' })).toEqual(
      { text: 'Refused', classes: 'govuk-tag--orange' }
    )
  })
})

describe('#ACTION_OPTIONS', () => {
  test('Should offer each action once, by its plain label, in label order', () => {
    const labels = ACTION_OPTIONS.map(({ text }) => text)

    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)))
    expect(ACTION_OPTIONS.map(({ value }) => value)).toContain('access.denied')
    expect(
      ACTION_OPTIONS.find(({ value }) => value === 'access.denied').text
    ).toBe('Access refused')
    expect(new Set(ACTION_OPTIONS.map(({ value }) => value)).size).toBe(
      ACTION_OPTIONS.length
    )
  })
})

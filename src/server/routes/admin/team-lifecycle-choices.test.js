import {
  canEnable,
  disabledEnvironmentsOf,
  enableMessage,
  knownEnvironments,
  offeredToDisable,
  resolveTeamEnvironments,
  teamEnvironmentChoices
} from './team-lifecycle-choices.js'

const team = {
  status: 'disabled',
  disabledEnvironments: ['infradev'],
  environments: [
    { environment: 'infradev', fileStatus: 'active', disabled: true },
    { environment: 'qa', fileStatus: 'active', disabled: false },
    { environment: 'prod', fileStatus: 'removed' }
  ]
}

describe('#knownEnvironments', () => {
  test('lists the team’s environments in order, with any it holds as disabled', () => {
    expect(knownEnvironments(team)).toEqual(['infradev', 'qa', 'prod'])
    expect(
      knownEnvironments({ disabledEnvironments: ['preprod'], environments: [] })
    ).toEqual(['preprod'])
    expect(knownEnvironments({})).toEqual([])
  })
})

describe('#disabledEnvironmentsOf', () => {
  test('takes the environments marked disabled and those the team lists, once each', () => {
    expect(disabledEnvironmentsOf(team)).toEqual(['infradev'])
    expect(
      disabledEnvironmentsOf({
        environments: [{ environment: 'qa', disabled: true }],
        disabledEnvironments: ['infradev']
      })
    ).toEqual(['qa', 'infradev'])
    expect(disabledEnvironmentsOf({})).toEqual([])
  })
})

describe('#offeredToDisable', () => {
  test('offers the environments not disabled already, and not one removed from the team', () => {
    expect(offeredToDisable(team)).toEqual(['qa'])
    expect(offeredToDisable({})).toEqual([])
  })
})

describe('#canEnable', () => {
  test('is true for a disabled team, or an environment that is disabled, and otherwise false', () => {
    expect(canEnable({ status: 'disabled' })).toBe(true)
    expect(
      canEnable({
        status: 'active',
        environments: [{ environment: 'qa', disabled: true }]
      })
    ).toBe(true)
    expect(canEnable({ status: 'active', environments: [] })).toBe(false)
    expect(canEnable({})).toBe(false)
  })
})

describe('#resolveTeamEnvironments', () => {
  const choices = { known: ['infradev', 'qa'], offered: ['qa'] }

  test('accepts none, which is allowed', () => {
    expect(resolveTeamEnvironments([], choices)).toEqual({ environments: [] })
  })

  test('accepts environments on offer', () => {
    expect(resolveTeamEnvironments(['qa'], choices)).toEqual({
      environments: ['qa']
    })
  })

  test('says one the team has but is not offered is not offered', () => {
    expect(resolveTeamEnvironments(['qa', 'infradev'], choices)).toEqual({
      problem: 'not-offered'
    })
  })

  test('says one the team does not have is unknown, ahead of any other problem', () => {
    expect(resolveTeamEnvironments(['infradev', 'moon'], choices)).toEqual({
      problem: 'unknown'
    })
  })
})

describe('#teamEnvironmentChoices', () => {
  test('makes a checkbox for each, named for people, with the ticked ones checked', () => {
    expect(teamEnvironmentChoices(['infradev', 'qa'], ['qa'])).toEqual([
      { value: 'infradev', text: 'Development', checked: false },
      { value: 'qa', text: 'Test', checked: true }
    ])
  })
})

describe('#enableMessage', () => {
  test.each([
    [['infradev', 'qa'], [], 'Team enabled and Development and Test unlocked.'],
    [[], [], 'Team enabled.'],
    [[], ['qa'], 'Team enabled. Test is still disabled.'],
    [
      ['infradev'],
      ['qa', 'prod'],
      'Team enabled and Development unlocked. Test and Production are still disabled.'
    ]
  ])(
    'says %j unlocked and %j still disabled as "%s"',
    (enabled, remaining, text) => {
      expect(enableMessage(enabled, remaining)).toBe(text)
    }
  )

  test.each([
    [['infradev'], [], 'Development unlocked.'],
    [['infradev', 'qa'], [], 'Development and Test unlocked.'],
    [
      ['infradev'],
      ['qa', 'prod'],
      'Development unlocked. Test and Production are still disabled.'
    ]
  ])(
    'for a team that was already enabled, says only that %j unlocked and %j still disabled: "%s"',
    (enabled, remaining, text) => {
      expect(
        enableMessage(enabled, remaining, { teamWasDisabled: false })
      ).toBe(text)
    }
  )
})

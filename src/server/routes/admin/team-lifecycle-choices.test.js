import { disabledEnvironmentsOf } from './team-lifecycle-choices.js'

const team = {
  status: 'disabled',
  disabledEnvironments: ['infradev'],
  environments: [
    { environment: 'infradev', fileStatus: 'active', disabled: true },
    { environment: 'qa', fileStatus: 'active', disabled: false },
    { environment: 'prod', fileStatus: 'removed' }
  ]
}

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

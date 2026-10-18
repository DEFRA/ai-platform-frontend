import { config } from '#/config/config.js'

import {
  environmentHint,
  environmentItems,
  environmentValues
} from './team-environments.js'

describe('team-environments', () => {
  const configured = config.get('teamEnvironments')

  afterEach(() => {
    config.set('teamEnvironments', configured)
  })

  test('offers the configured environments in order, the first preselected, under their display names', () => {
    config.set('teamEnvironments', ['infradev', 'sandbox', 'made-up'])

    expect(environmentValues()).toEqual(['infradev', 'sandbox', 'made-up'])
    expect(environmentItems()).toEqual([
      { value: 'infradev', text: 'Infradev', checked: true },
      { value: 'sandbox', text: 'Sandbox', checked: false },
      { value: 'made-up', text: 'made-up', checked: false }
    ])
  })

  test('keeps the environment already chosen checked, unless it is not on offer', () => {
    config.set('teamEnvironments', ['infradev', 'sandbox'])

    expect(
      environmentItems('sandbox').map((item) => [item.value, item.checked])
    ).toEqual([
      ['infradev', false],
      ['sandbox', true]
    ])
    expect(
      environmentItems('prod').map((item) => [item.value, item.checked])
    ).toEqual([
      ['infradev', true],
      ['sandbox', false]
    ])
  })

  test('says which environment is available when there is one', () => {
    config.set('teamEnvironments', ['infradev'])

    expect(environmentHint()).toBe('Only Infradev is available today.')
  })

  test('lists the environments available when there are several', () => {
    config.set('teamEnvironments', ['infradev', 'sandbox'])

    expect(environmentHint()).toBe('Available today: Infradev, Sandbox.')
  })
})

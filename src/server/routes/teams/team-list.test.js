import { buildTeamRow, summariseModels } from './team-list.js'

const modelNames = { 'gpt-4o': 'GPT-4o', 'gpt-4-1-nano': 'GPT-4.1 nano' }

function deployment(modelSlug, status, environment = 'infradev') {
  return { modelSlug, status, environment }
}

describe('#summariseModels', () => {
  test('lists each model once, by name, with nothing after a ready one', () => {
    expect(
      summariseModels(
        [deployment('gpt-4o', 'active'), deployment('gpt-4-1-nano', 'active')],
        modelNames
      )
    ).toEqual([
      { name: 'GPT-4.1 nano', suffix: null, failed: false },
      { name: 'GPT-4o', suffix: null, failed: false }
    ])
  })

  test.each([
    ['deploying', 'setting up', false],
    ['queued', 'setting up', false],
    ['removing', 'being removed', false],
    ['checks-failed', 'could not be set up', true],
    ['deploy-failed', 'could not be set up', true]
  ])('says a model that is %s is %s', (status, suffix, failed) => {
    expect(summariseModels([deployment('gpt-4o', status)], modelNames)).toEqual(
      [{ name: 'GPT-4o', suffix, failed }]
    )
  })

  test('leaves out a removed model', () => {
    expect(
      summariseModels([deployment('gpt-4o', 'removed')], modelNames)
    ).toEqual([])
  })

  test('reads a model in two environments as the worse of the two, whichever comes first', () => {
    const states = [
      deployment('gpt-4o', 'active'),
      deployment('gpt-4o', 'deploying', 'qa'),
      deployment('gpt-4o', 'deploy-failed', 'prod')
    ]

    expect(summariseModels(states, modelNames)).toEqual([
      { name: 'GPT-4o', suffix: 'could not be set up', failed: true }
    ])
    expect(summariseModels([...states].reverse(), modelNames)).toEqual([
      { name: 'GPT-4o', suffix: 'could not be set up', failed: true }
    ])
    expect(
      summariseModels(
        [
          deployment('gpt-4o', 'removing'),
          deployment('gpt-4o', 'active', 'qa')
        ],
        modelNames
      )
    ).toEqual([{ name: 'GPT-4o', suffix: 'being removed', failed: false }])
  })

  test('names a model by its slug when the catalogue does not list it', () => {
    expect(summariseModels([deployment('retired', 'active')], {})[0].name).toBe(
      'retired'
    )
  })
})

describe('#buildTeamRow', () => {
  const team = {
    name: 'Flood Risk Team',
    slug: 'flood-risk-team',
    role: 'admin'
  }

  test('links to the team by its slug, and says the role in words', () => {
    expect(
      buildTeamRow(team, { members: [], deployments: [] }, modelNames)
    ).toMatchObject({
      name: 'Flood Risk Team',
      href: '/teams/flood-risk-team',
      role: 'Admin'
    })
    expect(
      buildTeamRow(
        { ...team, role: 'user' },
        { members: [], deployments: [] },
        modelNames
      ).role
    ).toBe('Member')
  })

  test('counts the members who have not been removed, invited ones included', () => {
    const members = [
      { status: 'active' },
      { status: 'invited' },
      { status: 'removed' }
    ]

    expect(
      buildTeamRow(team, { members, deployments: [] }, modelNames).memberCount
    ).toBe(2)
  })

  test('has null for what could not be read', () => {
    expect(
      buildTeamRow(team, { members: null, deployments: null }, modelNames)
    ).toMatchObject({ memberCount: null, models: null })
  })
})

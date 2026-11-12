import { config } from '#/config/config.js'
import { buildOverviewTab } from './overview-tab.js'

const team = { slug: 'flood-risk-team', name: 'Flood Risk Team' }
const modelNames = { 'gpt-4o': 'GPT-4o', 'gpt-4-1-nano': 'GPT-4.1 nano' }

function summary(overrides = {}) {
  return {
    environment: 'infradev',
    setUp: true,
    models: {
      count: 2,
      items: [
        { id: 'd-1', modelSlug: 'gpt-4o', status: 'active' },
        { id: 'd-2', modelSlug: 'gpt-4-1-nano', status: 'deploying' }
      ]
    },
    applications: { used: 3, limit: 20 },
    ...overrides
  }
}

describe('#buildOverviewTab', () => {
  const configured = config.get('teamEnvironments')

  afterEach(() => {
    config.set('teamEnvironments', configured)
  })

  test('counts the models and applications in each available environment and links to its page', () => {
    const { environments, environmentsUrl } = buildOverviewTab(
      team,
      [summary()],
      modelNames
    )

    expect(environmentsUrl).toBe('/environments/flood-risk-team')
    expect(environments[0]).toEqual({
      code: 'infradev',
      name: 'Infradev',
      displayName: 'Development',
      href: '/environments/flood-risk-team/infradev',
      text: '2 models, 3 applications'
    })
  })

  test('says one model or one application in the singular', () => {
    const [infradev] = buildOverviewTab(
      team,
      [
        summary({
          models: { count: 1, items: [] },
          applications: { used: 1, limit: 20 }
        })
      ],
      modelNames
    ).environments

    expect(infradev.text).toBe('1 model, 1 application')
  })

  test('says an environment that is not available yet is not, with no link, and keeps its slot', () => {
    const { environments } = buildOverviewTab(team, [summary()], modelNames)

    expect(environments.slice(1)).toEqual([
      {
        code: 'qa',
        name: 'QA',
        displayName: 'Test',
        href: null,
        text: 'Not available yet'
      },
      {
        code: 'preprod',
        name: 'PREPROD',
        displayName: 'Pre-production',
        href: null,
        text: 'Not available yet'
      },
      {
        code: 'prod',
        name: 'PROD',
        displayName: 'Production',
        href: null,
        text: 'Not available yet'
      }
    ])
  })

  test('says an available environment is not set up when the team has not set it up', () => {
    const { environments } = buildOverviewTab(
      team,
      [summary({ setUp: false })],
      modelNames
    )

    expect(environments[0].text).toBe('Not set up yet')
  })

  test('says an available environment the backend sent nothing for is not available just now', () => {
    config.set('teamEnvironments', ['infradev', 'qa'])

    const { environments } = buildOverviewTab(team, [summary()], modelNames)

    expect(environments[1].text).toBe('Not available just now')
  })

  test('lists the models the team uses by name, once, with what is happening to each', () => {
    const { models } = buildOverviewTab(
      team,
      [
        summary(),
        summary({
          environment: 'qa',
          models: {
            count: 1,
            items: [
              { id: 'd-3', modelSlug: 'gpt-4o', status: 'active' },
              { id: 'd-4', modelSlug: 'gpt-5-mini', status: 'removed' }
            ]
          }
        })
      ],
      modelNames
    )

    expect(models).toEqual([
      { name: 'GPT-4.1 nano', suffix: 'setting up', failed: false },
      { name: 'GPT-4o', suffix: null, failed: false }
    ])
  })
})

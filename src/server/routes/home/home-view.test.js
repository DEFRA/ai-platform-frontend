import { buildAttention, buildKeysSummary, buildTeamRow } from './home-view.js'

const DAY_MS = 24 * 60 * 60 * 1000
const modelNames = { 'gpt-4o': 'GPT-4o', 'gpt-4-1-nano': 'GPT-4.1 nano' }
const adminTeam = {
  name: 'Flood Risk Team',
  slug: 'flood-risk-team',
  role: 'admin'
}
const memberTeam = {
  name: 'Plant Health Data',
  slug: 'plant-health-data',
  role: 'user'
}

function deployment(overrides = {}) {
  return {
    _id: 'deployment-1',
    modelSlug: 'gpt-4o',
    environment: 'infradev',
    status: 'active',
    ...overrides
  }
}

function key(daysLeft, overrides = {}) {
  return {
    _id: 'cred-1',
    modelDisplayName: 'GPT-4o',
    expired: false,
    expiresAt: new Date(Date.now() + daysLeft * DAY_MS).toISOString(),
    ...overrides
  }
}

describe('#buildTeamRow', () => {
  test('reads an admin of a team with a ready model', () => {
    expect(
      buildTeamRow({ team: adminTeam, deployments: [deployment()] }, modelNames)
    ).toEqual({
      name: 'Flood Risk Team',
      href: '/teams/flood-risk-team',
      summary: 'Admin. GPT-4o in Development.'
    })
  })

  test('reads a member, and puts environments in the order a team meets them', () => {
    const { summary } = buildTeamRow(
      {
        team: memberTeam,
        deployments: [
          deployment({ environment: 'prod' }),
          deployment({ environment: 'qa', modelSlug: 'gpt-4-1-nano' }),
          deployment({ _id: 'deployment-3' }),
          deployment({ _id: 'deployment-4', environment: 'elsewhere' })
        ]
      },
      modelNames
    )

    expect(summary).toBe(
      'Member. GPT-4o in Development. GPT-4.1 nano in Test. GPT-4o in Production. GPT-4o in elsewhere.'
    )
  })

  test('lists a model only once when it has two deployments in an environment', () => {
    const { summary } = buildTeamRow(
      {
        team: adminTeam,
        deployments: [deployment(), deployment({ _id: 'deployment-2' })]
      },
      modelNames
    )

    expect(summary).toBe('Admin. GPT-4o in Development.')
  })

  test('says a team with nothing to show has no models yet', () => {
    expect(
      buildTeamRow({ team: adminTeam, deployments: [] }, modelNames).summary
    ).toBe('Admin. No models yet.')
  })

  test('says it could not check when the deployments were not read', () => {
    expect(
      buildTeamRow({ team: memberTeam, deployments: null }, modelNames).summary
    ).toBe('Member. We could not check its models just now.')
  })
})

describe('#buildAttention', () => {
  test('is empty when nothing needs attention', () => {
    expect(
      buildAttention(
        [{ team: adminTeam, deployments: [deployment()] }],
        [key(10)],
        modelNames
      )
    ).toEqual([])
  })

  test('puts failures first, then set-ups in progress, then keys', () => {
    const items = buildAttention(
      [
        {
          team: memberTeam,
          deployments: [deployment({ _id: 'deployment-2', status: 'merged' })]
        },
        {
          team: adminTeam,
          deployments: [deployment({ status: 'deploy-failed' })]
        }
      ],
      [key(3)],
      modelNames
    )

    expect(items.map(({ linkText }) => linkText)).toEqual([
      'See what happened',
      'Check progress',
      'Renew it'
    ])
    expect(items[0].href).toBe(
      '/connect/team/request/flood-risk-team/deployment-1'
    )
  })

  test('leaves out an expired key and one with no expiry', () => {
    expect(
      buildAttention(
        [],
        [key(1, { expired: true }), key(1, { expiresAt: null })],
        modelNames
      )
    ).toEqual([])
  })
})

describe('#buildKeysSummary', () => {
  test('says there are no keys when there are none, or only expired ones', () => {
    const none = { text: 'You have no keys of your own.', hasKeys: false }

    expect(buildKeysSummary([])).toEqual(none)
    expect(buildKeysSummary([key(1, { expired: true })])).toEqual(none)
  })

  test('says how many, for which models, once each', () => {
    const { text, hasKeys } = buildKeysSummary([
      key(8),
      key(9, { _id: 'cred-2' }),
      key(10, { _id: 'cred-3', modelDisplayName: 'GPT-4.1 nano' })
    ])

    expect(hasKeys).toBe(true)
    expect(text).toMatch(
      /^You have 3 keys, for GPT-4\.1 nano and GPT-4o\. The first expires on /
    )
  })

  test('leaves the date out when no key says when it expires', () => {
    expect(buildKeysSummary([key(1, { expiresAt: null })]).text).toBe(
      'You have 1 key, for GPT-4o.'
    )
  })
})

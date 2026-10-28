import { config } from '#/config/config.js'
import { TEAM_SECRET_STATE } from './team-secret.js'
import { buildModelsTab } from './models-tab.js'

const team = { _id: 'team-1', slug: 'flood-risk-team', name: 'Flood Risk Team' }
const modelNames = { 'gpt-4o': 'GPT-4o', 'gpt-4-1-nano': 'GPT-4.1 nano' }
const environments = [
  {
    environment: 'infradev',
    limits: { requestsPerMinute: 60, tokensPerMinute: 1000 }
  }
]

function deployment(overrides = {}) {
  return {
    _id: 'deployment-1',
    modelSlug: 'gpt-4o',
    environment: 'infradev',
    status: 'active',
    ...overrides
  }
}

const credential = {
  _id: 'cred-1',
  tier: 'team',
  teamId: 'team-1',
  environment: 'infradev',
  status: 'active',
  expiresAt: '2027-10-19T00:00:00.000Z'
}

function build(overrides = {}) {
  return buildModelsTab({
    team,
    isAdmin: true,
    environments,
    deployments: [deployment()],
    credentials: [credential],
    modelNames,
    ...overrides
  })
}

describe('#buildModelsTab', () => {
  const configured = config.get('teamEnvironments')

  afterEach(() => {
    config.set('teamEnvironments', configured)
  })

  test('has a card for each available environment, in order, and says which are not available yet', () => {
    config.set('teamEnvironments', ['prod', 'infradev'])

    const { cards, notAvailableYet } = build()

    expect(cards.map(({ name }) => name)).toEqual(['Development', 'Production'])
    expect(notAvailableYet).toBe(
      'Test and Pre-production are not available yet.'
    )
  })

  test('says "is" for one environment not available yet, and nothing when all are', () => {
    config.set('teamEnvironments', ['infradev', 'qa', 'preprod'])

    expect(build().notAvailableYet).toBe('Production is not available yet.')

    config.set('teamEnvironments', ['infradev', 'qa', 'preprod', 'prod'])

    expect(build().notAvailableYet).toBeNull()
  })

  describe('a model', () => {
    function row(overrides, params) {
      return build({
        deployments: [deployment(overrides)],
        ...params
      }).cards[0].models[0]
    }

    test('is ready to use, with Remove for an admin and no other link', () => {
      expect(row()).toEqual({
        name: 'GPT-4o',
        statusText: 'Ready to use',
        tagClass: 'govuk-tag--green',
        inProgress: false,
        reason: null,
        detail: null,
        removeUrl: '/teams/flood-risk-team/models/deployment-1/remove'
      })
    })

    test('has no Remove for a member', () => {
      expect(row({}, { isAdmin: false }).removeUrl).toBeNull()
    })

    test.each(['checks-failed', 'deploy-failed'])(
      'that is %s can be seen and removed by an admin',
      (status) => {
        expect(row({ status })).toMatchObject({
          statusText: 'Setup failed',
          tagClass: 'govuk-tag--red',
          detail: {
            text: 'See what happened',
            href: '/connect/team/request/flood-risk-team/deployment-1'
          },
          removeUrl: '/teams/flood-risk-team/models/deployment-1/remove'
        })
      }
    )

    test('that timed out is failed, so an admin can see what happened and remove it', () => {
      expect(row({ status: 'timed-out' })).toMatchObject({
        statusText: 'Setup failed',
        detail: { text: 'See what happened' },
        removeUrl: '/teams/flood-risk-team/models/deployment-1/remove'
      })
    })

    test('that failed can be seen, but not removed, by a member', () => {
      expect(
        row({ status: 'deploy-failed' }, { isAdmin: false })
      ).toMatchObject({
        detail: { text: 'See what happened' },
        removeUrl: null
      })
    })

    test.each(['requested', 'committed', 'deploying', 'queued'])(
      'that is %s shows its progress and cannot be removed',
      (status) => {
        expect(row({ status })).toMatchObject({
          inProgress: true,
          detail: {
            text: 'See progress',
            href: '/connect/team/request/flood-risk-team/deployment-1'
          },
          removeUrl: null
        })
      }
    )

    test('that is being removed has no actions at all', () => {
      expect(row({ status: 'removing' })).toMatchObject({
        statusText: 'Removing',
        tagClass: 'govuk-tag--yellow',
        inProgress: true,
        detail: null,
        removeUrl: null
      })
    })

    test('with a status the page does not know has no actions, and is not progress', () => {
      expect(row({ status: 'something-new' })).toMatchObject({
        statusText: 'Status unknown',
        inProgress: false,
        detail: null,
        removeUrl: null
      })
    })

    test('that was ready again after a failed removal carries the reason', () => {
      expect(row({ failureReason: 'The change was rejected.' }).reason).toBe(
        'The change was rejected.'
      )
      expect(
        row({ status: 'deploy-failed', failureReason: 'Quota.' }).reason
      ).toBeNull()
    })

    test('is named by its slug when the catalogue does not list it', () => {
      expect(row({ modelSlug: 'retired-model' }).name).toBe('retired-model')
    })

    test('that was removed is left out', () => {
      const { models } = build({
        deployments: [
          deployment({ status: 'removed' }),
          deployment({ _id: 'deployment-2', modelSlug: 'gpt-4-1-nano' })
        ]
      }).cards[0]

      expect(models.map(({ name }) => name)).toEqual(['GPT-4.1 nano'])
    })
  })

  describe('the client secret', () => {
    function secret(params) {
      return build(params).cards[0].secret
    }

    test('shows when it expires, and for an admin View, Rotate and Revoke', () => {
      expect(secret()).toEqual({
        text: 'Expires 19 October 2027',
        actions: [
          {
            text: 'View',
            href: '/teams/flood-risk-team/client-secrets/cred-1/view'
          },
          {
            text: 'Rotate',
            href: '/teams/flood-risk-team/client-secrets/cred-1/rotate'
          },
          {
            text: 'Revoke',
            href: '/teams/flood-risk-team/client-secrets/cred-1/revoke'
          }
        ],
        askAnAdmin: false
      })
    })

    test('tells a member to ask an admin, with no links', () => {
      expect(secret({ isAdmin: false })).toEqual({
        text: 'Expires 19 October 2027',
        actions: [],
        askAnAdmin: true
      })
    })

    test('shows no date when the credential has no expiry', () => {
      expect(
        secret({ credentials: [{ ...credential, expiresAt: null }] }).text
      ).toBe('')
    })

    test.each([
      [
        TEAM_SECRET_STATE.preparing,
        [{ ...credential, vaultState: 'unwritten' }],
        'Being prepared. Check again in a moment.'
      ],
      [
        TEAM_SECRET_STATE.revoked,
        [
          {
            ...credential,
            status: 'revoked',
            revokedAt: '2026-10-22T00:00:00.000Z'
          }
        ],
        'Revoked'
      ],
      [TEAM_SECRET_STATE.none, [], 'Ready once a model has been set up.']
    ])(
      'says what it is when %s, with nothing to do',
      (_state, credentials, text) => {
        const row = secret({
          credentials,
          deployments: [deployment({ activatedAt: '2026-10-21T10:30:00.000Z' })]
        })

        expect(row).toEqual({ text })
      }
    )

    test('says it could not be checked when the credentials could not be read', () => {
      expect(secret({ credentials: null })).toEqual({
        text: 'We could not check this just now.'
      })
    })
  })

  describe('the limits', () => {
    test('read as requests and tokens a minute, with thousands separated', () => {
      expect(
        build({
          environments: [
            {
              environment: 'infradev',
              limits: { requestsPerMinute: 1200, tokensPerMinute: 150000 }
            }
          ]
        }).cards[0].limits
      ).toBe('1,200 requests and 150,000 tokens a minute')
    })

    test.each([
      [
        'are for another environment',
        [
          {
            environment: 'qa',
            limits: { requestsPerMinute: 1, tokensPerMinute: 1 }
          }
        ]
      ],
      [
        'are not agreed yet',
        [
          {
            environment: 'infradev',
            limits: { requestsPerMinute: null, tokensPerMinute: 1000 }
          }
        ]
      ],
      ['are not given', undefined]
    ])('are left out when they %s', (_why, given) => {
      expect(build({ environments: given }).cards[0].limits).toBeNull()
    })
  })

  describe('an environment', () => {
    beforeEach(() => {
      config.set('teamEnvironments', ['infradev', 'qa'])
    })

    test('the team never set up offers Set up, and has no secret or limits', () => {
      const [, test] = build().cards

      expect(test).toEqual({
        name: 'Test',
        setUpUrl: '/teams/flood-risk-team/test'
      })
    })

    test('with every model removed says so, and offers to add one', () => {
      const [development] = build({
        deployments: [deployment({ status: 'removed' })]
      }).cards

      expect(development).toEqual({
        name: 'Development',
        addModelUrl: '/connect/team/start',
        empty: true
      })
    })

    test('other than the first adds a model from its own page', () => {
      const [, test] = build({
        deployments: [
          deployment(),
          deployment({ _id: 'deployment-2', environment: 'qa' })
        ]
      }).cards

      expect(test.addModelUrl).toBe('/teams/flood-risk-team/test')
      expect(test.models).toHaveLength(1)
    })

    test('keeps its models, secret and limits apart from another’s', () => {
      const [development, test] = build({
        deployments: [
          deployment(),
          deployment({ _id: 'deployment-2', environment: 'qa' })
        ]
      }).cards

      expect(development.secret.actions).toHaveLength(3)
      expect(test.secret).toEqual({
        text: 'Ready once a model has been set up.'
      })
      expect(test.limits).toBeNull()
    })
  })

  describe('progress', () => {
    test.each(['deploying', 'queued', 'removing', 'committed'])(
      'is in progress while a model is %s',
      (status) => {
        expect(
          build({ deployments: [deployment({ status })] }).inProgress
        ).toBe(true)
      }
    )

    test.each(['active', 'deploy-failed', 'timed-out', 'removed'])(
      'is not in progress when the only model is %s',
      (status) => {
        expect(
          build({ deployments: [deployment({ status })] }).inProgress
        ).toBe(false)
      }
    )

    test('no longer asks for a refresh interval', () => {
      expect(
        build({ deployments: [deployment({ status: 'deploying' })] })
      ).not.toHaveProperty('refreshSeconds')
    })
  })
})

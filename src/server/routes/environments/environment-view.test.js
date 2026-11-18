import {
  buildCards,
  buildEnvironmentPage,
  buildStrip,
  formatWhen
} from './environment-view.js'
import { config } from '#/config/config.js'
import {
  clientSecretItem,
  clientSecretsOf
} from '#/test-helpers/environments-helpers.js'

const NOW = new Date('2026-11-12T12:00:00.000Z')
const modelNames = { 'gpt-4o': 'GPT-4o', 'gpt-4-1-mini': 'GPT-4.1 mini' }
const team = { _id: 'team-1', slug: 'flood-risk-team', name: 'Flood Risk Team' }

function summary(overrides = {}) {
  return {
    environment: 'infradev',
    setUp: true,
    paused: false,
    models: {
      count: 3,
      items: [{ id: 'd1', modelSlug: 'gpt-4o', status: 'active' }]
    },
    limits: { tokensPerMinute: 1000, requestsPerMinute: 60 },
    applications: { used: 0, limit: 20 },
    latestOperation: null,
    inProgress: false,
    ...overrides
  }
}

function operation(overrides = {}) {
  return {
    id: 'op-1',
    environment: 'infradev',
    kind: 'model',
    changes: [{ kind: 'model', change: 'add', modelSlug: 'gpt-4o' }],
    state: 'active',
    open: false,
    steps: ['a', 'b', 'c', 'd', 'e'].map((key) => ({
      key,
      label: key,
      status: 'done',
      at: '2026-11-12T10:20:00.000Z'
    })),
    requestedBy: { name: 'Jo Bloggs' },
    createdAt: '2026-11-12T10:20:00.000Z',
    failureReason: null,
    runUrl: null,
    supportReference: null,
    ...overrides
  }
}

function deployment(overrides = {}) {
  return {
    _id: 'deployment-1',
    teamId: 'team-1',
    modelSlug: 'gpt-4o',
    environment: 'infradev',
    status: 'active',
    ...overrides
  }
}

describe('environment-view', () => {
  const configured = config.get('teamEnvironments')

  afterEach(() => {
    config.set('teamEnvironments', configured)
  })

  describe('formatWhen', () => {
    test('says "Today at" a time for today and the date for another day', () => {
      expect(formatWhen('2026-11-12T10:20:00.000Z', NOW)).toBe('Today at 10:20')
      expect(formatWhen('2026-11-10T10:20:00.000Z', NOW)).toBe('10 November')
    })

    test('is empty when there is no time', () => {
      expect(formatWhen(null, NOW)).toBe('')
    })
  })

  describe('buildStrip', () => {
    test('has an item per slot, marks the current one and links only the available ones', () => {
      expect(buildStrip('flood-risk-team', 'infradev')).toEqual([
        {
          code: 'infradev',
          name: 'Infradev',
          displayName: 'Development',
          available: true,
          current: true,
          href: '/environments/flood-risk-team/infradev'
        },
        {
          code: 'qa',
          name: 'QA',
          displayName: 'Test',
          available: false,
          current: false,
          href: null
        },
        {
          code: 'preprod',
          name: 'PREPROD',
          displayName: 'Pre-production',
          available: false,
          current: false,
          href: null
        },
        {
          code: 'prod',
          name: 'PROD',
          displayName: 'Production',
          available: false,
          current: false,
          href: null
        }
      ])
    })

    test('marks nothing current when no environment is chosen', () => {
      expect(buildStrip('flood-risk-team').some(({ current }) => current)).toBe(
        false
      )
    })
  })

  describe('buildCards', () => {
    function cards(summaries, extra = {}) {
      return buildCards({
        team,
        summaries,
        modelNames,
        now: NOW,
        ...extra
      })
    }

    test('shows an available environment with its models, applications, token limit and latest change', () => {
      const [infradev] = cards([
        summary({
          latestOperation: operation({ createdAt: '2026-11-12T10:20:00.000Z' })
        })
      ])

      expect(infradev).toMatchObject({
        code: 'infradev',
        name: 'Infradev',
        displayName: 'Development',
        available: true,
        tag: { text: 'Available', tagClass: 'govuk-tag--green' },
        href: '/environments/flood-risk-team/infradev',
        linkText: 'View Infradev',
        setUp: true
      })
      expect(infradev.rows).toEqual([
        { key: 'Models', value: '3' },
        { key: 'Applications', value: '0 of 20' },
        { key: 'Tokens a minute', value: '1,000' },
        { key: 'Latest change', value: 'Deploy GPT-4o: Done, today at 10:20' }
      ])
    })

    test('says there is no change yet and no limits when the team has none', () => {
      const [infradev] = cards([
        summary({ limits: null, latestOperation: null })
      ])

      expect(infradev.rows.slice(2)).toEqual([
        { key: 'Tokens a minute', value: 'Not set up yet' },
        { key: 'Latest change', value: 'None yet' }
      ])
    })

    test('keeps a card for each slot, saying Not available yet, with no actions', () => {
      const unavailable = cards([summary()]).slice(1)

      expect(unavailable.map(({ code }) => code)).toEqual([
        'qa',
        'preprod',
        'prod'
      ])

      for (const card of unavailable) {
        expect(card).toMatchObject({
          available: false,
          tag: { text: 'Not available yet', tagClass: 'govuk-tag--grey' },
          href: null,
          setUpUrl: null
        })
        expect(card.message).toBe(
          `You cannot use ${card.name} yet. It opens to teams here when it is ready.`
        )
      }
    })

    test('offers to set up an available environment the team has not set up, and to deploy in the first one', () => {
      config.set('teamEnvironments', ['infradev', 'qa'])

      const [infradev, qa] = cards([
        summary({
          setUp: false,
          limits: null,
          models: { count: 0, items: [] }
        }),
        summary({
          environment: 'qa',
          setUp: false,
          limits: null,
          models: { count: 0, items: [] }
        })
      ])

      expect(infradev.setUp).toBe(false)
      expect(infradev.setUpUrl).toBeNull()
      expect(infradev.notSetUp).toBe(
        'Not set up yet. Deploy a model to set up Infradev.'
      )
      expect(qa.setUpUrl).toBe('/environments/flood-risk-team/qa/set-up')
      expect(qa.notSetUp).toBe('Not set up yet.')
      expect(qa.setUpText).toBe('Set up QA')
    })

    test('shows a paused environment as paused', () => {
      const [infradev] = cards([summary({ paused: true })])

      expect(infradev.tag).toEqual({
        text: 'Paused',
        tagClass: 'govuk-tag--yellow'
      })
      expect(infradev.pausedNote).toBe(
        'Changes wait here until the platform team resumes Infradev.'
      )
    })

    test('says it could not read an available environment the backend sent nothing for', () => {
      const [infradev] = cards([])

      expect(infradev.rows).toBeNull()
      expect(infradev.unreadable).toBe(true)
    })
  })

  describe('buildEnvironmentPage', () => {
    function page(overrides = {}) {
      return buildEnvironmentPage({
        team,
        isAdmin: true,
        environment: {
          environment: 'infradev',
          registryName: 'Infradev',
          name: 'Development'
        },
        detail: {
          ...summary(),
          models: [deployment()],
          limitBounds: {
            tokensPerMinute: { min: 1, max: 5000 },
            requestsPerMinute: { min: 1, max: 300 }
          },
          pendingLimits: null
        },
        operations: { open: [], recent: [] },
        modelNames,
        now: NOW,
        ...overrides
      })
    }

    test('names the environment and the team, with the strip and the deploy action', () => {
      const view = page()

      expect(view.heading).toBe('Infradev')
      expect(view.caption).toBe('Flood Risk Team')
      expect(view.displayName).toBe('Development')
      expect(view.deployUrl).toBe(
        '/connect/team/start?teamId=flood-risk-team&environment=infradev'
      )
      expect(view.strip.find(({ current }) => current).code).toBe('infradev')
    })

    test('lists each model with its state, and lets only an admin remove a ready one', () => {
      const detail = {
        ...summary(),
        models: [
          deployment(),
          deployment({
            _id: 'deployment-2',
            modelSlug: 'gpt-4-1-mini',
            status: 'deploying'
          })
        ],
        limitBounds: null,
        pendingLimits: null
      }
      const admin = page({ detail }).models
      const member = page({ detail, isAdmin: false }).models

      expect(admin.map(({ name, statusText }) => [name, statusText])).toEqual([
        ['GPT-4o', 'Ready to use'],
        ['GPT-4.1 mini', 'Setting up']
      ])
      expect(admin[0].removeUrl).toBe(
        '/teams/flood-risk-team/models/deployment-1/remove'
      )
      expect(admin[1].removeUrl).toBeNull()
      expect(admin[1].detail).toEqual({
        text: 'See progress',
        href: '/connect/team/request/flood-risk-team/deployment-2'
      })
      expect(member.every(({ removeUrl }) => removeUrl === null)).toBe(true)
    })

    test('shows the limits, and offers Change to an admin only', () => {
      expect(page().limits).toEqual({
        tokensPerMinute: '1,000',
        requestsPerMinute: '60',
        pending: null,
        changeUrl: '/environments/flood-risk-team/infradev/limits',
        changeLocked: false
      })
      expect(page({ isAdmin: false }).limits.changeUrl).toBeNull()
    })

    test('shows what a change in progress will set', () => {
      const view = page({
        detail: {
          ...summary(),
          models: [],
          limitBounds: null,
          pendingLimits: { tokensPerMinute: 2000, requestsPerMinute: 120 }
        }
      })

      expect(view.limits.pending).toBe(
        'Changing to 2,000 tokens and 120 requests a minute'
      )
    })

    test('has no limits to show or change when the environment is not set up', () => {
      const view = page({
        detail: {
          ...summary({ setUp: false, limits: null }),
          models: [],
          limitBounds: null,
          pendingLimits: null
        }
      })

      expect(view.setUp).toBe(false)
      expect(view.limits).toBeNull()
    })

    test('is in progress while a change is open or a model is still changing', () => {
      expect(page().inProgress).toBe(false)
      expect(
        page({
          operations: { open: [operation({ open: true })], recent: [] }
        }).inProgress
      ).toBe(true)
      expect(
        page({
          detail: {
            ...summary(),
            models: [deployment({ status: 'deploying' })],
            limitBounds: null,
            pendingLimits: null
          }
        }).inProgress
      ).toBe(true)
    })

    test('lists the changes in progress and the recent changes of this environment', () => {
      const view = page({
        operations: {
          open: [operation({ id: 'op-2', open: true })],
          recent: [operation()]
        }
      })

      expect(view.changes.map(({ id }) => id)).toEqual(['op-2'])
      expect(view.recent).toEqual([
        expect.objectContaining({
          when: 'Today at 10:20',
          change: 'Deploy GPT-4o',
          environmentName: 'Infradev',
          result: { text: 'Done', tagClass: 'govuk-tag--green' }
        })
      ])
    })

    test('builds the client secrets section from the environment read, and has no single secret row', () => {
      const view = page({
        detail: {
          ...summary(),
          clientSecrets: clientSecretsOf([clientSecretItem()]),
          models: [deployment()],
          limitBounds: null,
          pendingLimits: null
        }
      })

      expect(view.clientSecrets).toMatchObject({
        state: 'allowed',
        countText: '1 of 3 client secrets in use'
      })
      expect(view).not.toHaveProperty('secret')
      expect(
        page({ detail: { ...summary(), clientSecrets: undefined, models: [] } })
          .clientSecrets
      ).toBeNull()
    })
  })

  describe('with credentials disabled', () => {
    const NOT_LOCKED = { teamDisabled: false, disabledEnvironments: [] }

    function page(detailOverrides = {}, lock = NOT_LOCKED) {
      return buildEnvironmentPage({
        team,
        isAdmin: true,
        environment: {
          environment: 'infradev',
          registryName: 'Infradev',
          name: 'Development'
        },
        detail: {
          ...summary(),
          credentialsDisabled: true,
          applications: {
            used: 1,
            limit: 20,
            items: [
              {
                id: 'app-1',
                name: 'flood-api',
                host: 'cdp',
                service: 'flood-api',
                status: 'ready'
              }
            ]
          },
          clientSecrets: clientSecretsOf([clientSecretItem()]),
          models: [deployment()],
          limitBounds: {
            tokensPerMinute: { min: 1, max: 5000 },
            requestsPerMinute: { min: 1, max: 300 }
          },
          pendingLimits: null,
          ...detailOverrides
        },
        operations: { open: [], recent: [] },
        modelNames,
        lock,
        now: NOW
      })
    }

    test('says credentials are disabled, leaves the environment Available and never says why', () => {
      const view = page()

      expect(view.credentialsBanner).toEqual({
        heading: 'Credentials are disabled',
        message: expect.stringContaining('remove an application')
      })
      expect(view.tag.text).toBe('Available')
      expect(view.lockBanner).toBeNull()
      expect(JSON.stringify(view.credentialsBanner)).not.toMatch(
        /reason|because/i
      )
    })

    test('greys add, view, rotate, Federate and Change, and keeps Revoke and Remove', () => {
      const view = page()

      expect(view.clientSecrets).toMatchObject({
        addUrl: null,
        addLocked: true
      })
      expect(view.clientSecrets.items[0].actions).toEqual([
        { text: 'View', href: null },
        { text: 'Rotate', href: null },
        {
          text: 'Revoke',
          href: '/teams/flood-risk-team/client-secrets/cred-1/revoke'
        }
      ])
      expect(view.applications).toMatchObject({
        federateUrl: null,
        federateLocked: true
      })
      expect(view.applications.items[0]).toMatchObject({
        changeUrl: null,
        removeUrl: expect.stringContaining('/applications/app-1/remove'),
        lockedActions: ['Change']
      })
    })

    test('leaves models, limits and Deploy a model open', () => {
      const view = page()

      expect(view.deployLocked).toBe(false)
      expect(view.limits.changeUrl).toEqual(expect.any(String))
      expect(view.models[0].removeLocked).toBe(false)
    })

    test('shows nothing of it while credentials are enabled', () => {
      const view = page({ credentialsDisabled: false })

      expect(view.credentialsBanner).toBeNull()
      expect(view.clientSecrets.addLocked).toBe(false)
      expect(view.applications.federateLocked).toBe(false)
      expect(view.applications.items[0].lockedActions).toEqual([])
    })

    test('keeps a disabled environment greyed whole when both apply', () => {
      const view = page(
        {},
        { teamDisabled: false, disabledEnvironments: ['infradev'] }
      )

      expect(view.applications.items[0]).toMatchObject({
        removeUrl: null,
        lockedActions: ['Change', 'Remove']
      })
    })
  })

  describe('with the team disabled', () => {
    const disabledTeam = { teamDisabled: true, disabledEnvironments: [] }
    const infradevLocked = {
      teamDisabled: true,
      disabledEnvironments: ['infradev']
    }
    const federated = {
      used: 1,
      limit: 20,
      items: [
        {
          id: 'app-1',
          name: 'flood-api',
          host: 'cdp',
          service: 'flood-api',
          status: 'ready'
        }
      ]
    }

    function page(lock, overrides = {}) {
      return buildEnvironmentPage({
        team,
        isAdmin: true,
        environment: {
          environment: 'infradev',
          registryName: 'Infradev',
          name: 'Development'
        },
        detail: {
          ...summary(),
          applications: federated,
          clientSecrets: clientSecretsOf([clientSecretItem()]),
          models: [deployment()],
          limitBounds: {
            tokensPerMinute: { min: 1, max: 5000 },
            requestsPerMinute: { min: 1, max: 300 }
          },
          pendingLimits: null
        },
        operations: { open: [], recent: [] },
        modelNames,
        lock,
        now: NOW,
        ...overrides
      })
    }

    test('tags a disabled environment Disabled where it said Available, and ahead of Paused', () => {
      expect(page(infradevLocked).tag).toEqual({
        text: 'Disabled',
        tagClass: 'govuk-tag--grey'
      })
      expect(
        page(infradevLocked, {
          detail: {
            ...summary({ paused: true }),
            models: [],
            limitBounds: null
          }
        }).tag.text
      ).toBe('Disabled')
    })

    test('believes the environment read when it says the environment is disabled, though the team lists none', () => {
      const view = page(disabledTeam, {
        detail: { ...summary({ disabled: true }), models: [deployment()] }
      })

      expect(view.tag.text).toBe('Disabled')
      expect(view.models[0].removeLocked).toBe(true)
      expect(view.lockBanner).toEqual({
        heading: 'This team is disabled',
        message: 'You can view it but you cannot change it.'
      })
    })

    test('greys every environment action of a disabled environment, and keeps Revoke', () => {
      const view = page(infradevLocked)

      expect(view.models[0]).toMatchObject({
        removeUrl: null,
        removeLocked: true
      })
      expect(view.clientSecrets).toMatchObject({
        addUrl: null,
        addLocked: true
      })
      expect(view.clientSecrets.items[0].actions).toEqual([
        { text: 'View', href: null },
        { text: 'Rotate', href: null },
        {
          text: 'Revoke',
          href: '/teams/flood-risk-team/client-secrets/cred-1/revoke'
        }
      ])
      expect(view.limits).toMatchObject({
        changeUrl: null,
        changeLocked: true
      })
      expect(view.applications).toMatchObject({
        federateUrl: null,
        federateLocked: true
      })
      expect(view.applications.items[0]).toMatchObject({
        changeUrl: null,
        removeUrl: null,
        lockedActions: ['Change', 'Remove']
      })
      expect(view.deployLocked).toBe(true)
    })

    test('leaves an environment the admin did not tick usable, with the team banner and only the team-wide action greyed', () => {
      const view = page(disabledTeam)

      expect(view.tag.text).toBe('Available')
      expect(view.models[0].removeUrl).toBe(
        '/teams/flood-risk-team/models/deployment-1/remove'
      )
      expect(view.models[0].removeLocked).toBe(false)
      expect(view.clientSecrets.addLocked).toBe(false)
      expect(
        view.clientSecrets.items[0].actions.every(({ href }) => href)
      ).toBe(true)
      expect(view.limits.changeUrl).toBe(
        '/environments/flood-risk-team/infradev/limits'
      )
      expect(view.applications.items[0].changeUrl).toContain('/change')
      expect(view.deployLocked).toBe(false)
      expect(view.teamLocked).toBe(true)
      expect(view.lockBanner.heading).toBe('This team is disabled')
    })

    test('says on the page of a disabled environment of an active team that the environment is disabled', () => {
      const view = page({
        teamDisabled: false,
        disabledEnvironments: ['infradev']
      })

      expect(view.lockBanner.heading).toBe('This environment is disabled')
      expect(view.teamLocked).toBe(false)
    })

    test('has no banner and nothing greyed for a team that is not disabled', () => {
      const view = page({ teamDisabled: false, disabledEnvironments: [] })

      expect(view.lockBanner).toBeNull()
      expect(view.deployLocked).toBe(false)
      expect(view.models[0].removeLocked).toBe(false)
    })

    test('shows no greyed action to a member, who has none', () => {
      const view = page(infradevLocked, { isAdmin: false })

      expect(view.models[0].removeLocked).toBe(false)
      expect(view.limits.changeLocked).toBe(false)
      expect(view.applications.items[0].lockedActions).toEqual([])
    })

    test('greys deploying where the environment is not set up and the team is disabled, because that sets it up', () => {
      config.set('teamEnvironments', ['infradev', 'qa'])

      const view = buildEnvironmentPage({
        team,
        isAdmin: true,
        environment: { environment: 'qa', registryName: 'QA', name: 'Test' },
        detail: { ...summary({ environment: 'qa', setUp: false }), models: [] },
        operations: { open: [], recent: [] },
        modelNames,
        lock: disabledTeam,
        now: NOW
      })

      expect(view.deployLocked).toBe(true)
      expect(view.setUpUrl).toBeNull()
      expect(view.setUpLocked).toBe(true)
    })

    test('has the overview card of a disabled environment tagged Disabled, and of one the team lists, whatever the environment read says', () => {
      const [fromRead] = buildCards({
        team,
        summaries: [summary({ disabled: true })],
        modelNames,
        now: NOW
      })
      const [fromTeam] = buildCards({
        team,
        summaries: [summary()],
        modelNames,
        lock: infradevLocked,
        now: NOW
      })

      expect(fromRead.tag.text).toBe('Disabled')
      expect(fromTeam.tag.text).toBe('Disabled')
    })

    test('greys setting up another environment on the cards while the team is disabled, but not for the first', () => {
      config.set('teamEnvironments', ['infradev', 'qa'])

      const notSetUp = {
        setUp: false,
        limits: null,
        models: { count: 0, items: [] }
      }
      const [infradev, qa] = buildCards({
        team,
        summaries: [
          summary(notSetUp),
          summary({ environment: 'qa', ...notSetUp })
        ],
        modelNames,
        lock: disabledTeam,
        now: NOW
      })

      expect(infradev.setUpLocked).toBe(false)
      expect(qa).toMatchObject({
        setUpUrl: null,
        setUpText: 'Set up QA',
        setUpLocked: true
      })
      expect(qa.tag.text).toBe('Available')
    })
  })

  describe('what the cards and the page leave unsaid', () => {
    test('says a latest change with no time without one', () => {
      const [infradev] = buildCards({
        team,
        summaries: [
          summary({ latestOperation: operation({ createdAt: undefined }) })
        ],
        modelNames,
        now: NOW
      })

      expect(infradev.rows.at(-1).value).toBe('Deploy GPT-4o: Done')
    })

    test('offers to set up an environment that is not set up, unless it is the first, where a deploy is the way', () => {
      config.set('teamEnvironments', ['infradev', 'qa'])

      const notSetUp = (environment) =>
        buildEnvironmentPage({
          team,
          isAdmin: true,
          environment: {
            environment,
            registryName: environment.toUpperCase(),
            name: environment
          },
          detail: {
            ...summary({ environment, setUp: false, limits: null }),
            models: [],
            limitBounds: null,
            pendingLimits: null
          },
          operations: { open: [], recent: [] },
          modelNames,
          now: NOW
        })

      expect(notSetUp('qa').setUpUrl).toBe(
        '/environments/flood-risk-team/qa/set-up'
      )
      expect(notSetUp('infradev').setUpUrl).toBeNull()
    })

    test('says a limit the team file does not hold is not set, rather than 0', () => {
      const view = buildEnvironmentPage({
        team,
        isAdmin: true,
        environment: {
          environment: 'infradev',
          registryName: 'Infradev',
          name: 'Development'
        },
        detail: {
          ...summary({
            limits: { tokensPerMinute: null, requestsPerMinute: null }
          }),
          models: [],
          limitBounds: null,
          pendingLimits: null
        },
        operations: { open: [], recent: [] },
        modelNames,
        now: NOW
      })

      expect(view.limits).toMatchObject({
        tokensPerMinute: 'Not set',
        requestsPerMinute: 'Not set'
      })
    })
  })
})

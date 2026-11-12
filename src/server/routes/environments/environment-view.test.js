import {
  buildCards,
  buildEnvironmentPage,
  buildStrip,
  formatWhen
} from './environment-view.js'
import { config } from '#/config/config.js'

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
        credentials: [],
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
        changeUrl: '/environments/flood-risk-team/infradev/limits'
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

    test('keeps the team client secret as built: dates and actions for an admin, "Ask an admin" for a member', () => {
      const credentials = [
        {
          _id: 'cred-1',
          tier: 'team',
          teamId: 'team-1',
          environment: 'infradev',
          status: 'active',
          expiresAt: '2027-10-19T00:00:00.000Z',
          createdAt: '2026-10-21T10:45:00.000Z'
        }
      ]

      expect(page({ credentials }).secret).toEqual({
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
      expect(page({ credentials, isAdmin: false }).secret).toMatchObject({
        actions: [],
        askAnAdmin: true
      })
      expect(page({ credentials: null }).secret).toEqual({
        text: 'We could not check this just now.'
      })
      expect(page().secret.text).toBe('Ready once a model has been set up.')
      expect(
        page({
          detail: {
            ...summary(),
            models: [],
            limitBounds: null,
            pendingLimits: null
          }
        }).secret
      ).toBeNull()
    })
  })
})

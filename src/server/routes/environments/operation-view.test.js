import {
  buildOperationItem,
  buildOperationSteps,
  describeChange
} from './operation-view.js'

const modelNames = { 'gpt-4o': 'GPT-4o', 'gpt-4-1-mini': 'GPT-4.1 mini' }

function steps(statuses, times = []) {
  const labels = [
    'Request received',
    'Checks passed',
    'Deploying',
    'Deployed',
    'Ready to use'
  ]

  return labels.map((label, index) => ({
    key: label.toLowerCase(),
    label,
    status: statuses[index],
    at: times[index] ?? null
  }))
}

function operation(overrides = {}) {
  return {
    id: 'op-1234567',
    environment: 'infradev',
    kind: 'model',
    changes: [{ kind: 'model', change: 'add', modelSlug: 'gpt-4o' }],
    state: 'deploying',
    open: true,
    steps: steps(
      ['done', 'done', 'current', 'todo', 'todo'],
      [
        '2026-11-12T10:41:00.000Z',
        '2026-11-12T10:42:00.000Z',
        '2026-11-12T10:42:30.000Z'
      ]
    ),
    requestedBy: { name: 'Jo Bloggs' },
    createdAt: '2026-11-12T10:41:00.000Z',
    updatedAt: '2026-11-12T10:42:30.000Z',
    failureReason: null,
    runUrl: null,
    supportReference: null,
    ...overrides
  }
}

describe('describeChange', () => {
  test('says what a model change does, by the model name', () => {
    expect(describeChange(operation(), modelNames)).toEqual({
      plain: 'Deploy GPT-4o',
      progressive: 'Deploying GPT-4o'
    })
    expect(
      describeChange(
        operation({
          changes: [{ kind: 'model', change: 'remove', modelSlug: 'gpt-4o' }]
        }),
        modelNames
      )
    ).toEqual({ plain: 'Remove GPT-4o', progressive: 'Removing GPT-4o' })
  })

  test('falls back to the slug for a model the catalogue does not name', () => {
    expect(
      describeChange(
        operation({
          changes: [{ kind: 'model', change: 'add', modelSlug: 'new-model' }]
        }),
        modelNames
      ).plain
    ).toBe('Deploy new-model')
  })

  test('groups several models under one verb', () => {
    expect(
      describeChange(
        operation({
          changes: [
            { kind: 'model', change: 'add', modelSlug: 'gpt-4o' },
            { kind: 'model', change: 'add', modelSlug: 'gpt-4-1-mini' }
          ]
        }),
        modelNames
      ).plain
    ).toBe('Deploy GPT-4o and GPT-4.1 mini')
  })

  test('says what a limits change sets, with the numbers formatted', () => {
    expect(
      describeChange(
        operation({
          kind: 'limits',
          changes: [
            {
              kind: 'limits',
              change: 'set',
              limits: { tokensPerMinute: 12000, requestsPerMinute: 72 }
            }
          ]
        }),
        modelNames
      )
    ).toEqual({
      plain: 'Change limits to 12,000 tokens and 72 requests a minute',
      progressive: 'Changing limits to 12,000 tokens and 72 requests a minute'
    })
  })

  test('joins a mixed change and names an unknown kind plainly', () => {
    expect(
      describeChange(
        operation({
          kind: 'mixed',
          changes: [
            { kind: 'model', change: 'add', modelSlug: 'gpt-4o' },
            {
              kind: 'limits',
              change: 'set',
              limits: { tokensPerMinute: 1000, requestsPerMinute: 60 }
            }
          ]
        }),
        modelNames
      ).plain
    ).toBe(
      'Deploy GPT-4o and change limits to 1,000 tokens and 60 requests a minute'
    )
    expect(
      describeChange(
        operation({
          kind: 'federation',
          changes: [{ kind: 'federation', change: 'add' }]
        }),
        modelNames
      )
    ).toEqual({
      plain: 'Change applications',
      progressive: 'Changing applications'
    })
    expect(
      describeChange(operation({ kind: 'revert', changes: [] }), modelNames)
    ).toEqual({
      plain: 'Put back the earlier version',
      progressive: 'Putting back the earlier version'
    })
  })
})

describe('buildOperationSteps', () => {
  test('maps each step to the step list, with its time as the hint', () => {
    expect(
      buildOperationSteps(
        steps(
          ['done', 'done', 'current', 'todo', 'todo'],
          [
            '2026-11-12T10:41:00.000Z',
            '2026-11-12T10:42:00.000Z',
            '2026-11-12T10:42:30.000Z'
          ]
        )
      )
    ).toEqual([
      { text: 'Request received', state: 'done', hint: '10:41' },
      { text: 'Checks passed', state: 'done', hint: '10:42' },
      { text: 'Deploying', state: 'current', hint: 'Started at 10:42' },
      { text: 'Deployed', state: 'waiting', hint: undefined },
      { text: 'Ready to use', state: 'waiting', hint: undefined }
    ])
  })

  test('marks the failed step as failed, with the time it failed', () => {
    expect(
      buildOperationSteps(
        steps(
          ['done', 'failed', 'todo', 'todo', 'todo'],
          ['2026-11-12T10:41:00.000Z', '2026-11-12T10:43:00.000Z']
        )
      )[1]
    ).toEqual({
      text: 'Checks passed',
      state: 'failed',
      hint: 'Failed at 10:43'
    })
  })

  test('copes with no steps', () => {
    expect(buildOperationSteps(undefined)).toEqual([])
  })
})

describe('buildOperationItem', () => {
  test('describes a change in progress', () => {
    const item = buildOperationItem(operation(), { modelNames })

    expect(item).toMatchObject({
      id: 'op-1234567',
      heading: 'Deploying GPT-4o in Infradev',
      change: 'Deploy GPT-4o',
      environment: 'infradev',
      environmentName: 'Infradev',
      askedBy: 'Asked for by Jo Bloggs at 10:41',
      stepText: 'Step 3 of 5',
      result: { text: 'In progress', tagClass: 'govuk-tag--yellow' },
      failed: false,
      open: true
    })
    expect(item.steps.map(({ state }) => state)).toEqual([
      'done',
      'done',
      'current',
      'waiting',
      'waiting'
    ])
    expect(item.failure).toBeNull()
  })

  test('reads a change that has gone through as done', () => {
    const item = buildOperationItem(
      operation({
        open: false,
        state: 'active',
        steps: steps(['done', 'done', 'done', 'done', 'done'])
      }),
      { modelNames }
    )

    expect(item.result).toEqual({ text: 'Done', tagClass: 'govuk-tag--green' })
    expect(item.stepText).toBeNull()
    expect(item.failed).toBe(false)
  })

  test('shows why a step failed, with the run to follow and the reference to quote', () => {
    const item = buildOperationItem(
      operation({
        open: false,
        state: 'checks-failed',
        steps: steps(['done', 'failed', 'todo', 'todo', 'todo']),
        failureReason: 'The checks refused the change.',
        runUrl: 'https://github.com/DEFRA/ai-platform-tenants/actions/runs/1',
        supportReference: 'AIP-34567'
      }),
      { modelNames }
    )

    expect(item.result).toEqual({ text: 'Failed', tagClass: 'govuk-tag--red' })
    expect(item.failed).toBe(true)
    expect(item.failure).toEqual({
      reason: 'The checks refused the change.',
      runUrl: 'https://github.com/DEFRA/ai-platform-tenants/actions/runs/1',
      reference: 'AIP-34567'
    })
  })

  test('shows only an https run link', () => {
    const item = buildOperationItem(
      operation({
        open: false,
        steps: steps(['done', 'failed', 'todo', 'todo', 'todo']),
        failureReason: 'No.',
        runUrl: 'javascript:alert(1)'
      }),
      { modelNames }
    )

    expect(item.failure.runUrl).toBeNull()
  })

  test('leaves out who asked when the backend does not say', () => {
    expect(
      buildOperationItem(operation({ requestedBy: null }), { modelNames })
        .askedBy
    ).toBe('Asked for at 10:41')
  })

  test('says an ended change that neither failed nor finished was not applied', () => {
    const item = buildOperationItem(
      operation({
        open: false,
        state: 'merged',
        steps: steps(['done', 'todo', 'todo', 'todo', 'todo'])
      }),
      { modelNames }
    )

    expect(item.result).toEqual({
      text: 'Not applied',
      tagClass: 'govuk-tag--grey'
    })
  })

  test('names an environment the registry does not know by its code', () => {
    expect(
      buildOperationItem(operation({ environment: 'qa' }), { modelNames })
        .environmentName
    ).toBe('QA')
  })

  test('copes with a change that carries no changes, steps, time or reason', () => {
    const bare = buildOperationItem(
      {
        id: 'op-bare',
        environment: 'infradev',
        kind: 'model',
        open: false,
        requestedBy: null
      },
      { modelNames }
    )

    expect(bare).toMatchObject({
      change: 'Change this environment',
      askedBy: 'Asked for',
      steps: [],
      stepText: null,
      failed: false,
      result: { text: 'Not applied' }
    })
  })

  test('says a failed change has no reason when the backend gave none', () => {
    expect(
      buildOperationItem(
        operation({
          open: false,
          steps: steps(['done', 'failed', 'todo', 'todo', 'todo']),
          failureReason: undefined,
          supportReference: undefined
        }),
        { modelNames }
      ).failure
    ).toEqual({ reason: null, runUrl: null, reference: null })
  })

  test('says a change to a kind of thing it does not know, and a change of a model it has no verb for, plainly', () => {
    expect(
      describeChange(
        operation({
          changes: [{ kind: 'model', change: 'pause', modelSlug: 'gpt-4o' }]
        }),
        modelNames
      )
    ).toEqual({ plain: 'Change GPT-4o', progressive: 'Changing GPT-4o' })
    expect(
      describeChange(operation({ kind: 'model', changes: [] }), modelNames)
        .plain
    ).toBe('Change this environment')
  })

  test('has a step number only for a change that is open and has a step in progress', () => {
    expect(
      buildOperationItem(
        operation({
          open: true,
          steps: steps(['done', 'todo', 'todo', 'todo', 'todo'])
        }),
        { modelNames }
      ).stepText
    ).toBeNull()
  })
})

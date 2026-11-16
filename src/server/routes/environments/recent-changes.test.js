import {
  RECENT_CHANGES,
  buildStatusChangeRows,
  mergeRecent
} from './recent-changes.js'

const NOW = new Date('2026-11-16T12:00:00.000Z')

describe('#buildStatusChangeRows', () => {
  test('says a disable and an enable in the platform team’s words, with no reason and no name', () => {
    const rows = buildStatusChangeRows(
      [
        {
          change: 'disabled',
          environments: ['infradev', 'qa'],
          at: '2026-11-16T10:00:00.000Z'
        },
        { change: 'enabled', environments: [], at: '2026-11-15T09:00:00.000Z' }
      ],
      { now: NOW }
    )

    expect(rows).toEqual([
      {
        id: 'status-disabled-2026-11-16T10:00:00.000Z',
        createdAt: '2026-11-16T10:00:00.000Z',
        when: 'Today at 10:00',
        change: 'Team disabled by the platform team',
        environmentName: 'Infradev and QA',
        result: { text: 'Done', tagClass: 'govuk-tag--green' },
        failure: null
      },
      {
        id: 'status-enabled-2026-11-15T09:00:00.000Z',
        createdAt: '2026-11-15T09:00:00.000Z',
        when: '15 November',
        change: 'Team enabled by the platform team',
        environmentName: null,
        result: { text: 'Done', tagClass: 'govuk-tag--green' },
        failure: null
      }
    ])
    expect(JSON.stringify(rows)).not.toMatch(/reason|@/)
  })

  test('names three environments in a list', () => {
    const [row] = buildStatusChangeRows([
      {
        change: 'disabled',
        environments: ['infradev', 'qa', 'prod'],
        at: '2026-11-16T10:00:00.000Z'
      }
    ])

    expect(row.environmentName).toBe('Infradev, QA and PROD')
  })

  test('reads a change with no environment list as none, and leaves out a change it has no words for', () => {
    const rows = buildStatusChangeRows([
      { change: 'disabled', at: '2026-11-16T10:00:00.000Z' },
      { change: 'archived', at: '2026-11-16T10:01:00.000Z' }
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].environmentName).toBeNull()
  })
})

describe('#mergeRecent', () => {
  const operation = (id, createdAt) => ({ id, createdAt })

  test('puts operations and status changes in one list, newest first', () => {
    const merged = mergeRecent(
      [
        operation('op-2', '2026-11-14T10:00:00.000Z'),
        operation('op-1', '2026-11-12T10:00:00.000Z')
      ],
      [{ id: 'status-1', createdAt: '2026-11-13T10:00:00.000Z' }]
    )

    expect(merged.map(({ id }) => id)).toEqual(['op-2', 'status-1', 'op-1'])
  })

  test('keeps to the same row limit, dropping the oldest', () => {
    const operations = Array.from({ length: RECENT_CHANGES }, (_, index) =>
      operation(
        `op-${index}`,
        `2026-11-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`
      )
    )
    const merged = mergeRecent(operations, [
      { id: 'newest', createdAt: '2026-11-30T10:00:00.000Z' }
    ])

    expect(merged).toHaveLength(RECENT_CHANGES)
    expect(merged[0].id).toBe('newest')
    expect(merged.map(({ id }) => id)).not.toContain('op-0')
  })

  test('uses a limit it is given', () => {
    expect(
      mergeRecent(
        [operation('a', '2026-11-12T10:00:00.000Z')],
        [{ id: 'b', createdAt: '2026-11-13T10:00:00.000Z' }],
        1
      ).map(({ id }) => id)
    ).toEqual(['b'])
  })

  test('is just the operations when there are no status changes', () => {
    expect(
      mergeRecent([operation('a', '2026-11-12T10:00:00.000Z')], [])
    ).toEqual([operation('a', '2026-11-12T10:00:00.000Z')])
  })
})

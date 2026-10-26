import {
  buildPipelineLinks,
  buildStepItems,
  supportReference
} from './team-request-view.js'

describe('team-request-view', () => {
  describe('supportReference', () => {
    test('is AIP- and the last five characters of the operation id, in upper case', () => {
      expect(supportReference('op-1234567-7f3k2')).toBe('AIP-7F3K2')
    })

    test('uses the whole id when it is shorter than five characters', () => {
      expect(supportReference('ab1')).toBe('AIP-AB1')
    })

    test.each([undefined, null, '', 42])('has none for %s', (operationId) => {
      expect(supportReference(operationId)).toBeNull()
    })
  })

  describe('buildStepItems', () => {
    test('gives a done step its time, the step in progress "Started at", and a waiting step nothing', () => {
      expect(
        buildStepItems([
          {
            label: 'Request recorded',
            state: 'done',
            at: '2026-10-21T10:41:00Z'
          },
          {
            label: 'Setting up GPT-4o in Azure',
            state: 'current',
            at: '2026-10-21T10:42:00Z'
          },
          { label: 'Preparing your client secret', state: 'pending', at: null }
        ])
      ).toEqual([
        { text: 'Request recorded', state: 'done', hint: '10:41' },
        {
          text: 'Setting up GPT-4o in Azure',
          state: 'current',
          hint: 'Started at 10:42'
        },
        {
          text: 'Preparing your client secret',
          state: 'waiting',
          hint: undefined
        }
      ])
    })

    test('has no steps when the backend sends none', () => {
      expect(buildStepItems(null)).toEqual([])
      expect(buildStepItems(undefined)).toEqual([])
    })
  })

  describe('buildPipelineLinks', () => {
    test('labels the submit run and the apply run, https only', () => {
      expect(
        buildPipelineLinks({
          submitRun: 'https://github.com/o/r/actions/runs/1',
          pullRequest: 'https://github.com/o/r/pull/7',
          applyRun: 'http://github.com/o/r/actions/runs/2'
        })
      ).toEqual([
        {
          href: 'https://github.com/o/r/actions/runs/1',
          text: 'Submit run'
        }
      ])
    })

    test('shows both runs in that order, and no pull request link', () => {
      expect(
        buildPipelineLinks({
          applyRun: 'https://github.com/o/r/actions/runs/2',
          pullRequest: 'https://github.com/o/r/pull/7',
          submitRun: 'https://github.com/o/r/actions/runs/1'
        })
      ).toEqual([
        { href: 'https://github.com/o/r/actions/runs/1', text: 'Submit run' },
        { href: 'https://github.com/o/r/actions/runs/2', text: 'Apply run' }
      ])
    })

    test('has none by default', () => {
      expect(buildPipelineLinks()).toEqual([])
    })
  })
})

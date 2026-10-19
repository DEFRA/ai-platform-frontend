import {
  FAILURE_STATUSES,
  IN_PROGRESS_STATUSES,
  buildPipelineLinks,
  waitPageHeading
} from './team-request-view.js'

describe('team-request-view', () => {
  test('keeps the in-progress and failure statuses apart', () => {
    expect(IN_PROGRESS_STATUSES).toContain('queued')
    expect(IN_PROGRESS_STATUSES).toContain('deploying')
    expect(FAILURE_STATUSES).toEqual(['checks-failed', 'deploy-failed'])
    expect(
      IN_PROGRESS_STATUSES.filter((status) => FAILURE_STATUSES.includes(status))
    ).toEqual([])
  })

  test('explains a queued request differently from one being set up', () => {
    expect(waitPageHeading(['queued'])).toBe(
      'Waiting for another change to this team to finish'
    )
    expect(waitPageHeading(['deploying'])).toBe('Setting up your model access')
  })

  test('promises the client secret only once every request has reached that step', () => {
    expect(waitPageHeading(['verified'])).toBe(
      'Setting up your team client secret'
    )
    expect(waitPageHeading(['verified', 'verified'])).toBe(
      'Setting up your team client secret'
    )
    expect(waitPageHeading(['verified', 'deploying'])).toBe(
      'Setting up your model access'
    )
    expect(waitPageHeading(['queued', 'verified'])).toBe(
      'Setting up your model access'
    )
  })

  test('labels the GitOps links it knows and shows https ones only', () => {
    expect(
      buildPipelineLinks({
        submitRun:
          'https://github.com/DEFRA/ai-platform-tenants/actions/runs/1',
        pullRequest: 'http://github.com/DEFRA/ai-platform-tenants/pull/2',
        applyRun: 42,
        other: 'https://example.test'
      })
    ).toEqual([
      {
        href: 'https://github.com/DEFRA/ai-platform-tenants/actions/runs/1',
        text: 'Submit workflow run'
      }
    ])
    expect(buildPipelineLinks()).toEqual([])
  })
})

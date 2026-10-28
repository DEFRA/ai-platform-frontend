import {
  DEPLOYMENT_FAILURE_STATUSES,
  deploymentStatusText,
  deploymentTagClass,
  isDeploymentInProgress
} from './deployment-status.js'

describe('deployment-status', () => {
  test.each([
    ['active', 'Ready to use', 'govuk-tag--green', false],
    ['queued', 'Waiting', 'govuk-tag--grey', true],
    ['requested', 'Setting up', 'govuk-tag--yellow', true],
    ['committed', 'Setting up', 'govuk-tag--yellow', true],
    ['deploying', 'Setting up', 'govuk-tag--yellow', true],
    ['deployed', 'Setting up', 'govuk-tag--yellow', true],
    ['verified', 'Setting up', 'govuk-tag--yellow', true],
    ['removing', 'Removing', 'govuk-tag--yellow', true],
    ['removed', 'Removed', 'govuk-tag--grey', false],
    ['checks-failed', 'Setup failed', 'govuk-tag--red', false],
    ['deploy-failed', 'Setup failed', 'govuk-tag--red', false],
    ['timed-out', 'Setup failed', 'govuk-tag--red', false]
  ])(
    'reads %s as "%s", tagged %s, in progress: %s',
    (status, text, tagClass, inProgress) => {
      expect(deploymentStatusText(status)).toBe(text)
      expect(deploymentTagClass(status)).toBe(tagClass)
      expect(isDeploymentInProgress(status)).toBe(inProgress)
    }
  )

  test.each(['pr-raised', 'merged', 'verifying'])(
    'reads %s, which the platform no longer sends or never did, as unknown and not as progress',
    (status) => {
      expect(deploymentStatusText(status)).toBe('Status unknown')
      expect(deploymentTagClass(status)).toBe('govuk-tag--grey')
      expect(isDeploymentInProgress(status)).toBe(false)
    }
  )

  test('counts a timed-out request as a failure, so its page shows what happened', () => {
    expect(DEPLOYMENT_FAILURE_STATUSES).toEqual([
      'checks-failed',
      'deploy-failed',
      'timed-out'
    ])
  })

  test('gives no two different states the same text', () => {
    expect(deploymentStatusText('active')).not.toBe(
      deploymentStatusText('requested')
    )
    expect(deploymentStatusText('queued')).not.toBe(
      deploymentStatusText('requested')
    )
    expect(deploymentStatusText('removing')).not.toBe(
      deploymentStatusText('removed')
    )
  })
})

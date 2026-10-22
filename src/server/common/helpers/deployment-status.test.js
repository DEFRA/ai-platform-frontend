import {
  deploymentStatusText,
  deploymentTagClass,
  isDeploymentInProgress
} from './deployment-status.js'

describe('deployment-status', () => {
  test.each([
    ['active', 'Ready to use', 'govuk-tag--green', false],
    ['queued', 'Waiting for another change', 'govuk-tag--grey', true],
    ['requested', 'Setting up', 'govuk-tag--yellow', true],
    ['pr-raised', 'Setting up', 'govuk-tag--yellow', true],
    ['merged', 'Setting up', 'govuk-tag--yellow', true],
    ['deploying', 'Setting up', 'govuk-tag--yellow', true],
    ['deployed', 'Setting up', 'govuk-tag--yellow', true],
    ['verified', 'Setting up', 'govuk-tag--yellow', true],
    ['removing', 'Removing', 'govuk-tag--yellow', true],
    ['removed', 'Removed', 'govuk-tag--grey', false],
    ['checks-failed', 'Setup failed', 'govuk-tag--red', false],
    ['deploy-failed', 'Setup failed', 'govuk-tag--red', false]
  ])(
    'reads %s as "%s", tagged %s, in progress: %s',
    (status, text, tagClass, inProgress) => {
      expect(deploymentStatusText(status)).toBe(text)
      expect(deploymentTagClass(status)).toBe(tagClass)
      expect(isDeploymentInProgress(status)).toBe(inProgress)
    }
  )

  test('reads a status it does not know as unknown, not as progress', () => {
    expect(deploymentStatusText('verifying')).toBe('Status unknown')
    expect(deploymentTagClass('verifying')).toBe('govuk-tag--grey')
    expect(isDeploymentInProgress('verifying')).toBe(false)
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

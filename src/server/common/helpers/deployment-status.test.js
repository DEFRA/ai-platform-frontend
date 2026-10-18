import {
  deploymentStatusText,
  deploymentTagClass,
  isDeploymentInProgress
} from './deployment-status.js'

describe('deployment-status', () => {
  test.each([
    ['active', 'Ready to view', 'govuk-tag--green', false],
    ['queued', 'Waiting for another change', 'govuk-tag--grey', true],
    ['requested', 'Setting up', 'govuk-tag--yellow', true],
    ['deploying', 'Setting up', 'govuk-tag--yellow', true],
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

  test('treats a status it does not know as still setting up', () => {
    expect(deploymentStatusText('verifying')).toBe('Setting up')
    expect(deploymentTagClass('verifying')).toBe('govuk-tag--yellow')
    expect(isDeploymentInProgress('verifying')).toBe(true)
  })
})

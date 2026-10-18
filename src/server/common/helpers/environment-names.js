// Display names for the platform's environments (design A), keyed by the
// codes the registry and team files use. An unknown code is shown as it is.
const ENVIRONMENT_NAMES = {
  infradev: 'Infradev',
  sandbox: 'Sandbox',
  dev: 'Development',
  qa: 'QA',
  test: 'Test',
  preprod: 'Pre-production',
  prod: 'Production',
  uat: 'UAT'
}

// Research keys carry no environment of their own: the Research tier runs
// in the Sandbox in Phase 1 (design A).
const RESEARCH_ENVIRONMENT = 'sandbox'

/**
 * The display name of an environment code.
 * @param {string} value
 * @returns {string}
 */
export function environmentName(value) {
  return ENVIRONMENT_NAMES[value] ?? value
}

/**
 * The environment a credential is for, by display name: a team credential's
 * own, the Research tier's otherwise.
 * @param {{tier?: string, environment?: string|null}} credential
 * @returns {string}
 */
export function credentialEnvironmentName(credential) {
  return environmentName(
    credential.tier === 'team' && credential.environment
      ? credential.environment
      : RESEARCH_ENVIRONMENT
  )
}

import { config } from '#/config/config.js'

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

// A credential issued before environments were recorded on it was issued in
// the hand-built Sandbox (the backend's backfill gives it the same value).
const LEGACY_CREDENTIAL_ENVIRONMENT = 'sandbox'

/**
 * The display name of an environment code.
 * @param {string} value
 * @returns {string}
 */
export function environmentName(value) {
  return ENVIRONMENT_NAMES[value] ?? value
}

/**
 * The environment code research keys are issued in from this instance.
 * @returns {string}
 */
export function researchEnvironment() {
  return config.get('researchEnvironment')
}

/**
 * The environment code a credential was issued in.
 * @param {{environment?: string|null}} credential
 * @returns {string}
 */
export function credentialEnvironment(credential) {
  return credential.environment ?? LEGACY_CREDENTIAL_ENVIRONMENT
}

/**
 * The environment a credential is for, by display name.
 * @param {{environment?: string|null}} credential
 * @returns {string}
 */
export function credentialEnvironmentName(credential) {
  return environmentName(credentialEnvironment(credential))
}

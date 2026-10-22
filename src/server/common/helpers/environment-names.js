import { config } from '#/config/config.js'

// Display names for the platform's environments (D12), keyed by the codes the
// registry and team files use. An unknown code is shown as it is.
const ENVIRONMENT_NAMES = {
  infradev: 'Development',
  sandbox: 'Sandbox',
  dev: 'Development',
  qa: 'Test',
  preprod: 'Pre-production',
  prod: 'Production'
}

// The environments in the order a team meets them. A slot is one name; the
// `dev` slot is filled by `infradev` on the CDP test instance.
const ENVIRONMENT_SLOTS = [['dev', 'infradev'], ['qa'], ['preprod'], ['prod']]

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
 * The environments a team meets, in order (`dev`, `qa`, `preprod`, `prod`),
 * each marked available when `teamEnvironments` lists it. An environment that
 * is not listed keeps its slot, so a page can say it is not available yet.
 * @returns {Array<{environment: string, name: string, available: boolean}>}
 */
export function teamEnvironmentList() {
  const configured = config.get('teamEnvironments')

  return ENVIRONMENT_SLOTS.map((codes) => {
    const configuredCode = codes.find((code) => configured.includes(code))
    const environment = configuredCode ?? codes[0]

    return {
      environment,
      name: environmentName(environment),
      available: configuredCode !== undefined
    }
  })
}

/**
 * The environment a new request goes to: the first available one.
 * @returns {string|undefined}
 */
export function defaultTeamEnvironment() {
  return teamEnvironmentList().find((item) => item.available)?.environment
}

/**
 * Where a team sets up an environment. The one place the address is built, so
 * it can later point at the Environments page by changing only this.
 * @param {string} teamSlug
 * @param {string} environment the environment code
 * @returns {string}
 */
export function environmentSetUpUrl(teamSlug, environment) {
  return `/teams/${encodeURIComponent(teamSlug)}/${environmentName(environment).toLowerCase()}`
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

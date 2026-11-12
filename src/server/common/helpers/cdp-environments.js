// Which CDP environment each AI Platform environment trusts (design E, CDP
// Web Identity trust). Page copy only: the registry holds the issuer and
// account, and Terraform derives them, so nothing here is a trust value
// (choice E).
const CDP_ENVIRONMENTS = {
  infradev: 'dev',
  sandbox: 'dev',
  dev: 'dev',
  qa: 'test',
  preprod: 'perf-test',
  prod: 'prod'
}

/**
 * The CDP environment an environment's registration trusts.
 * @param {string} environment - The environment code.
 * @returns {string | undefined}
 */
export function cdpEnvironmentName(environment) {
  return CDP_ENVIRONMENTS[environment]
}

/**
 * The CDP environment as page copy: "CDP’s test environment".
 * @param {string} environment - The environment code.
 * @returns {string | null}
 */
export function cdpTrustText(environment) {
  const name = cdpEnvironmentName(environment)

  return name ? `CDP’s ${name} environment` : null
}

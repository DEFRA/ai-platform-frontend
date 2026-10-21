// Which of a team's client secrets a page is about, by the backend's rules
// (credential-service `ensureTeamCredential`): a team has one per
// environment, the backend grants its models to it when they turn active, and
// a revocation only stands when it came after the newest activation (a model
// that turns active later gives the team a fresh one).

const ACTIVE_STATUS = 'active'
const REVOKED_STATUS = 'revoked'
const VAULT_UNWRITTEN = 'unwritten'

export const TEAM_SECRET_STATE = {
  ready: 'ready',
  preparing: 'preparing',
  revoked: 'revoked',
  none: 'none'
}

// The newest time a model turned active in the environment.
function newestActivation(deployments, environment) {
  return deployments
    .filter((deployment) => deployment.environment === environment)
    .map(({ activatedAt }) => activatedAt)
    .filter(Boolean)
    .sort()
    .at(-1)
}

/**
 * The team's client secret for an environment, and where it has got to:
 * `ready` (in the vault, so it can be shown), `preparing` (active but not yet
 * written to the vault), `revoked` (for good: revoked after the newest
 * activation) or `none` (not given yet, including an older revoked one with a
 * replacement still on its way).
 * @param {object[]} credentials - The signed-in person's credentials.
 * @param {object[]} deployments - The team's deployments.
 * @param {{teamId: string, environment: string}} scope
 * @returns {{state: string, credential: object | null}}
 */
export function teamSecretFor(credentials, deployments, scope) {
  const ofTeam = credentials
    .filter(
      (credential) =>
        credential.tier === 'team' &&
        credential.teamId === scope.teamId &&
        credential.environment === scope.environment
    )
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  const active = ofTeam.find(({ status }) => status === ACTIVE_STATUS)

  if (active) {
    return {
      state:
        active.vaultState === VAULT_UNWRITTEN
          ? TEAM_SECRET_STATE.preparing
          : TEAM_SECRET_STATE.ready,
      credential: active
    }
  }

  const [latest] = ofTeam
  const activatedAt = newestActivation(deployments, scope.environment)

  if (
    latest?.status === REVOKED_STATUS &&
    activatedAt &&
    latest.revokedAt &&
    latest.revokedAt >= activatedAt
  ) {
    return { state: TEAM_SECRET_STATE.revoked, credential: latest }
  }

  return { state: TEAM_SECRET_STATE.none, credential: null }
}

// What the Platform Admin's team page says of a team's environments, from the
// backend's read of the team (`GET /v1/admin/teams/{id}`). An environment is
// disabled only by Disable credentials, never by Disable team.

/**
 * The environments that are disabled: the backend marks each, and lists them
 * on the team too; either says so.
 * @param {{environments?: Array<{environment: string, disabled?: boolean}>, disabledEnvironments?: string[]}} team
 * @returns {string[]}
 */
export function disabledEnvironmentsOf(team) {
  const marked = (team.environments ?? [])
    .filter(({ disabled }) => disabled)
    .map(({ environment }) => environment)

  return [...new Set([...marked, ...(team.disabledEnvironments ?? [])])]
}

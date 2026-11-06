import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { defaultTeamEnvironment } from '#/server/common/helpers/environment-names.js'
import { loadModelChoices, pickableSlugs } from './team-model-choices.js'

// The team a person chose, as the backend knows it. A team the person does
// not belong to is the same answer as one that does not exist.
export async function findChosenTeam(request, slug) {
  try {
    const { team } = await apiClient(request).get(
      `/v1/teams/${encodeURIComponent(slug)}`
    )

    return team
  } catch (error) {
    if (
      error instanceof ApiError &&
      [statusCodes.forbidden, statusCodes.notFound].includes(error.statusCode)
    ) {
      return null
    }

    throw error
  }
}

function modelEnvironment(pendingAccess) {
  return pendingAccess.environment ?? defaultTeamEnvironment()
}

export function loadChoicesFor(request, pendingAccess) {
  const environment = modelEnvironment(pendingAccess)

  return loadModelChoices(request, {
    teamSlug: pendingAccess.teamSlug,
    environment,
    // Another environment is set up from the models the team has ready in the
    // first one, so changing the models or the team offers the same ones.
    readyIn:
      environment === defaultTeamEnvironment()
        ? undefined
        : defaultTeamEnvironment()
  })
}

// A model a person came to from its page is the whole choice when it is the
// only one on offer, so the step is skipped.
export function isSingleModelFromItsPage(pendingAccess, choices) {
  const pickable = pickableSlugs(choices)

  return (
    !pendingAccess.modelSlugs?.length &&
    pickable.length === 1 &&
    pendingAccess.modelSlug === pickable[0]
  )
}

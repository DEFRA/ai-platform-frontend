import { apiClient } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import { DEPLOYMENT_REMOVED_STATUS } from '#/server/common/helpers/deployment-status.js'

const ALREADY_SET_UP_HINT = 'Already set up for this team'

/**
 * The team-tier catalogue and the models the team already has (any not
 * removed), which cannot be requested again.
 * @param {import('@hapi/hapi').Request} request
 * @param {string} teamId
 * @returns {Promise<{models: object[], held: Set<string>}>}
 */
export async function loadModelChoices(request, teamId) {
  const client = apiClient(request)
  const [{ items: models }, { items: deployments }] = await Promise.all([
    client.get('/v1/models?tier=team'),
    client.get(`/v1/teams/${teamId}/deployments`, {
      userId: getSessionUser(request).id
    })
  ])

  return {
    models,
    held: new Set(
      deployments
        .filter(({ status }) => status !== DEPLOYMENT_REMOVED_STATUS)
        .map(({ modelSlug }) => modelSlug)
    )
  }
}

/**
 * GOV.UK checkbox items: a model the team already has is shown, not
 * selectable, and never ticked.
 * @param {{models: object[], held: Set<string>}} choices
 * @param {string[]} selected - Slugs to tick.
 * @returns {object[]}
 */
export function buildModelCheckboxes({ models, held }, selected) {
  return models.map((model) =>
    held.has(model.slug)
      ? {
          value: model.slug,
          text: model.displayName,
          hint: { text: ALREADY_SET_UP_HINT },
          disabled: true
        }
      : {
          value: model.slug,
          text: model.displayName,
          hint: { text: model.description },
          checked: selected.includes(model.slug)
        }
  )
}

/**
 * The chosen slugs that are not on offer: not in the catalogue, or already
 * the team's. The form only ever posts offered ones.
 * @param {{models: object[], held: Set<string>}} choices
 * @param {string[]} chosen
 * @returns {string[]}
 */
export function unavailableSlugs({ models, held }, chosen) {
  const offered = new Set(
    models.map(({ slug }) => slug).filter((slug) => !held.has(slug))
  )

  return chosen.filter((slug) => !offered.has(slug))
}

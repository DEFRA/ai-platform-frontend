import { apiClient } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import { DEPLOYMENT_REMOVED_STATUS } from '#/server/common/helpers/deployment-status.js'
import {
  TEAM_AVAILABILITY,
  isCapacityDuplicate,
  isEligible,
  teamAvailability,
  useCasesList
} from '#/server/routes/models/model-availability.js'

const ALREADY_SET_UP_HINT = 'Already set up for this team'

function listedModels(models) {
  return models.filter((model) => !isCapacityDuplicate(model))
}

/**
 * What the model step offers a team: the models that run in the UK and that
 * the target environment can deploy, the models the team already has (any not
 * removed, which cannot be requested again), and the names of the models that
 * are not in the UK yet, so the page can say so.
 * @param {import('@hapi/hapi').Request} request
 * @param {{teamSlug: string, environment?: string}} journey
 * @returns {Promise<{models: object[], held: Set<string>, notInUkNames: string[]}>}
 */
export async function loadModelChoices(request, { teamSlug, environment }) {
  const client = apiClient(request)
  const teamModels = environment
    ? `/v1/models?tier=team&environment=${encodeURIComponent(environment)}`
    : '/v1/models?tier=team'
  const [{ items: offered }, { items: catalogue }, { items: deployments }] =
    await Promise.all([
      client.get(teamModels),
      client.get('/v1/models'),
      client.get(`/v1/teams/${encodeURIComponent(teamSlug)}/deployments`, {
        userId: getSessionUser(request).id
      })
    ])

  return {
    models: listedModels(offered).filter(
      (model) =>
        isEligible(model) && teamAvailability(model) === TEAM_AVAILABILITY.inUk
    ),
    held: new Set(
      deployments
        .filter(({ status }) => status !== DEPLOYMENT_REMOVED_STATUS)
        .map(({ modelSlug }) => modelSlug)
    ),
    notInUkNames: listedModels(catalogue)
      .filter(
        (model) =>
          isEligible(model) &&
          teamAvailability(model) === TEAM_AVAILABILITY.notInUk
      )
      .map(({ displayName }) => displayName)
  }
}

/**
 * GOV.UK checkbox items: a model the team already has is shown, not
 * selectable, and never ticked; the others carry their use cases as a hint.
 * @param {{models: object[], held: Set<string>}} choices
 * @param {string[]} selected - Slugs to tick.
 * @returns {object[]}
 */
export function buildModelCheckboxes({ models, held }, selected) {
  return models.map((model) => {
    if (held.has(model.slug)) {
      return {
        value: model.slug,
        text: model.displayName,
        hint: { text: ALREADY_SET_UP_HINT },
        disabled: true
      }
    }

    const useCases = useCasesList(model.useCases)

    return {
      value: model.slug,
      text: model.displayName,
      hint: useCases ? { text: useCases } : undefined,
      checked: selected.includes(model.slug)
    }
  })
}

/**
 * The slugs a person can pick: on offer and not already the team's.
 * @param {{models: object[], held: Set<string>}} choices
 * @returns {string[]}
 */
export function pickableSlugs({ models, held }) {
  return models.map(({ slug }) => slug).filter((slug) => !held.has(slug))
}

/**
 * The chosen slugs that are not on offer: not in the catalogue, or already
 * the team's. The form only ever posts offered ones.
 * @param {{models: object[], held: Set<string>}} choices
 * @param {string[]} chosen
 * @returns {string[]}
 */
export function unavailableSlugs(choices, chosen) {
  const pickable = new Set(pickableSlugs(choices))

  return chosen.filter((slug) => !pickable.has(slug))
}

/**
 * The names of the models not in the UK yet, as the model step's inset says
 * it, or null when there are none.
 * @param {string[]} names
 * @returns {string | null}
 */
export function notInUkSentence(names) {
  if (names.length === 0) {
    return null
  }

  return `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} not available to teams in the UK yet.`
}

/**
 * Names as one phrase: "A", "A and B", "A, B and C".
 * @param {string[]} names
 * @returns {string}
 */
export function joinNames(names) {
  if (names.length < 2) {
    return names.join('')
  }

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

import { isSameDay, parseISO } from 'date-fns'

import { apiClient } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import {
  DEPLOYMENT_FAILURE_STATUSES,
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS
} from '#/server/common/helpers/deployment-status.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import { joinNames } from './team-model-choices.js'

// The radio that sends a person to create a team instead of choosing one. A
// team slug can never hold a "+".
export const CREATE_TEAM_VALUE = '+create'

const GONE_STATUSES = [
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS,
  ...DEPLOYMENT_FAILURE_STATUSES
]

function roleText(team) {
  return team.role === 'admin' ? 'You are an admin.' : 'You are a member.'
}

function isCreatedToday(team) {
  return (
    Boolean(team.createdAt) && isSameDay(parseISO(team.createdAt), new Date())
  )
}

function modelsText(team, deployments, environment, modelNames) {
  const slugs = [
    ...new Set(
      deployments
        .filter(
          ({ status, environment: deployed }) =>
            deployed === environment && !GONE_STATUSES.includes(status)
        )
        .map(({ modelSlug }) => modelSlug)
    )
  ]

  if (slugs.length > 0) {
    const names = slugs.map((slug) => modelNames[slug] ?? slug)

    return `Has ${joinNames(names)} in ${environmentName(environment)}.`
  }

  return isCreatedToday(team)
    ? 'Created today, no models yet.'
    : 'No models yet.'
}

async function loadModelNames(client) {
  const { items } = await client.get('/v1/models?includeIneligible=true')

  return Object.fromEntries(
    items.map(({ slug, displayName }) => [slug, displayName])
  )
}

/**
 * The teams a person belongs to, each with what the team page says about
 * it: the person's role, then the models it has in the environment a new
 * request goes to (or that it was created today with none).
 * @param {import('@hapi/hapi').Request} request
 * @param {string | undefined} environment
 * @returns {Promise<Array<{slug: string, name: string, hint: string}>>}
 */
export async function loadTeamChoices(request, environment) {
  const client = apiClient(request)
  const userId = getSessionUser(request).id
  const { items: teams } = await client.get('/v1/teams', { userId })
  const deploymentLists = await Promise.all(
    teams.map(({ slug }) =>
      client.get(`/v1/teams/${encodeURIComponent(slug)}/deployments`, {
        userId
      })
    )
  )
  const hasModels = deploymentLists.some(({ items }) => items.length > 0)
  const modelNames = hasModels ? await loadModelNames(client) : {}

  return teams.map((team, index) => ({
    slug: team.slug,
    name: team.name,
    hint: `${roleText(team)} ${modelsText(team, deploymentLists[index].items, environment, modelNames)}`
  }))
}

/**
 * GOV.UK radio items for the team step: one per team, then "or" and the
 * radio that creates a team.
 * @param {Array<{slug: string, name: string, hint: string}>} teams
 * @param {string | undefined} selectedSlug
 * @returns {object[]}
 */
export function buildTeamItems(teams, selectedSlug) {
  return [
    ...teams.map((team) => ({
      value: team.slug,
      text: team.name,
      hint: { text: team.hint },
      checked: team.slug === selectedSlug
    })),
    { divider: 'or' },
    { value: CREATE_TEAM_VALUE, text: 'Create a team' }
  ]
}

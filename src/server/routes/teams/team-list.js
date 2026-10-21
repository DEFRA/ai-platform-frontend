import { apiClient } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import {
  DEPLOYMENT_FAILURE_STATUSES,
  DEPLOYMENT_REMOVED_STATUS,
  DEPLOYMENT_REMOVING_STATUS,
  isDeploymentInProgress
} from '#/server/common/helpers/deployment-status.js'
import { teamUrl } from './team-view.js'

const REMOVED_MEMBER_STATUS = 'removed'

// What a model's line says after its name, worst first: a model in two
// environments reads as the worse of its two states. A ready model needs no
// words.
const MODEL_STATES = [
  { suffix: 'could not be set up', failed: true },
  { suffix: 'setting up' },
  { suffix: 'being removed' },
  { suffix: null }
]

function modelStateOf(status) {
  if (DEPLOYMENT_FAILURE_STATUSES.includes(status)) {
    return MODEL_STATES[0]
  }

  if (status === DEPLOYMENT_REMOVING_STATUS) {
    return MODEL_STATES[2]
  }

  return isDeploymentInProgress(status) ? MODEL_STATES[1] : MODEL_STATES[3]
}

/**
 * A team's models, one line each, by name: what each is (nothing for a ready
 * one, "setting up", "being removed" or "could not be set up") across every
 * environment. A removed model is history and is left out.
 * @param {object[]} deployments
 * @param {Record<string, string>} modelNames - Display names by slug.
 * @returns {Array<{name: string, suffix: string | null, failed: boolean}>}
 */
export function summariseModels(deployments, modelNames) {
  const stateBySlug = new Map()

  for (const { modelSlug, status } of deployments) {
    if (status === DEPLOYMENT_REMOVED_STATUS) {
      continue
    }

    const state = modelStateOf(status)
    const known = stateBySlug.get(modelSlug)

    if (!known || MODEL_STATES.indexOf(state) < MODEL_STATES.indexOf(known)) {
      stateBySlug.set(modelSlug, state)
    }
  }

  return [...stateBySlug]
    .map(([slug, state]) => ({
      name: modelNames[slug] ?? slug,
      suffix: state.suffix,
      failed: Boolean(state.failed)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * One row of the Teams table.
 * @param {{name: string, slug: string, role: string}} team - A team from the person's list.
 * @param {{members: object[] | null, deployments: object[] | null}} details - What was read about it; null for what could not be.
 * @param {Record<string, string>} modelNames - Display names by slug.
 * @returns {object}
 */
export function buildTeamRow(team, { members, deployments }, modelNames) {
  return {
    name: team.name,
    href: teamUrl(team),
    role: team.role === 'admin' ? 'Admin' : 'Member',
    memberCount: members
      ? members.filter(({ status }) => status !== REMOVED_MEMBER_STATUS).length
      : null,
    models: deployments ? summariseModels(deployments, modelNames) : null
  }
}

/**
 * The Teams table: each team of the person's with its members and models.
 * One read of the team and one of its deployments per team (D9); a read that
 * fails leaves its cells saying so rather than taking the page down.
 * @param {import('@hapi/hapi').Request} request
 * @returns {Promise<object[]>}
 */
export async function loadTeamRows(request) {
  const client = apiClient(request)
  const userId = getSessionUser(request).id
  const { items: teams } = await client.get('/v1/teams', { userId })

  if (teams.length === 0) {
    return []
  }

  const [catalogue, ...reads] = await Promise.allSettled([
    client.get('/v1/models?includeIneligible=true'),
    ...teams.flatMap((team) => [
      client.get(`/v1/teams/${encodeURIComponent(team.slug)}`, { userId }),
      client.get(`/v1/teams/${encodeURIComponent(team.slug)}/deployments`, {
        userId
      })
    ])
  ])
  const modelNames = Object.fromEntries(
    (catalogue.value?.items ?? []).map((model) => [
      model.slug,
      model.displayName
    ])
  )

  if (catalogue.status === 'rejected') {
    request.logger.warn(
      { err: catalogue.reason },
      'Could not read the model names for the teams list'
    )
  }

  return teams.map((team, index) => {
    const [detail, deployments] = reads.slice(index * 2, index * 2 + 2)

    for (const failed of [detail, deployments]) {
      if (failed.status === 'rejected') {
        request.logger.warn(
          { err: failed.reason },
          'Could not read part of the teams list'
        )
      }
    }

    return buildTeamRow(
      team,
      {
        members: detail.status === 'fulfilled' ? detail.value.members : null,
        deployments:
          deployments.status === 'fulfilled' ? deployments.value.items : null
      },
      modelNames
    )
  })
}

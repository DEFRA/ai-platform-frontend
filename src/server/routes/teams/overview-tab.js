import { apiClient } from '#/server/common/helpers/api-client.js'
import {
  environmentPageUrl,
  environmentRegistryName,
  teamEnvironmentList,
  teamEnvironmentsUrl
} from '#/server/common/helpers/environment-names.js'
import { readTeamEnvironments } from '#/server/routes/environments/environments-api.js'
import { summariseModels } from './team-list.js'

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function environmentLine(slot, summary) {
  if (!slot.available) {
    return 'Not available yet'
  }

  if (!summary) {
    return 'Not available just now'
  }

  if (!summary.setUp) {
    return 'Not set up yet'
  }

  return `${plural(summary.models.count, 'model')}, ${plural(summary.applications.used, 'application')}`
}

/**
 * What the Overview tab says of a team's environments, from the backend's read
 * of them: for each environment slot the team's models and applications, or that
 * it is not available yet, and the models the team uses by name.
 * @param {{slug: string}} team
 * @param {object[]} summaries - The backend's environments.
 * @param {Record<string, string>} modelNames - Display names by slug.
 * @returns {{environments: object[], models: object[], environmentsUrl: string}}
 */
export function buildOverviewTab(team, summaries, modelNames) {
  return {
    environments: teamEnvironmentList().map((slot) => {
      const summary = summaries.find(
        ({ environment }) => environment === slot.environment
      )

      return {
        code: slot.environment,
        name: environmentRegistryName(slot.environment),
        displayName: slot.name,
        href: slot.available
          ? environmentPageUrl(team.slug, slot.environment)
          : null,
        text: environmentLine(slot, summary)
      }
    }),
    models: summariseModels(
      summaries.flatMap(({ models }) => models.items),
      modelNames
    ),
    environmentsUrl: teamEnvironmentsUrl(team.slug)
  }
}

/**
 * The Overview tab of a team: what it has in each environment. The
 * environments are what the tab is about, so a failure to read them is said
 * on the tab rather than shown as a team with nothing; the model names only
 * add to it, so a failure to read them leaves the slugs.
 * @param {import('@hapi/hapi').Request} request
 * @param {{slug: string}} team
 * @returns {Promise<{unavailable: boolean, environmentsUrl: string, environments?: object[], models?: object[]}>}
 */
export async function loadOverviewTab(request, team) {
  const [environments, catalogue] = await Promise.allSettled([
    readTeamEnvironments(request, team.slug),
    apiClient(request).get('/v1/models?includeIneligible=true')
  ])

  for (const failed of [environments, catalogue]) {
    if (failed.status === 'rejected') {
      request.logger.warn(
        { err: failed.reason },
        'Could not read part of the team Overview tab'
      )
    }
  }

  if (environments.status === 'rejected') {
    return {
      unavailable: true,
      environmentsUrl: teamEnvironmentsUrl(team.slug)
    }
  }

  return {
    unavailable: false,
    ...buildOverviewTab(
      team,
      environments.value.environments,
      Object.fromEntries(
        (catalogue.value?.items ?? []).map((model) => [
          model.slug,
          model.displayName
        ])
      )
    )
  }
}

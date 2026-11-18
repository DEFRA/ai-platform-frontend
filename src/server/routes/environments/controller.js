import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient } from '#/server/common/helpers/api-client.js'
import {
  defaultTeamEnvironment,
  environmentFromAddress,
  environmentPageUrl,
  teamEnvironmentsUrl
} from '#/server/common/helpers/environment-names.js'
import {
  getEnvironmentsTeam,
  setEnvironmentsTeam,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import {
  isDeployLocked,
  lockContext
} from '#/server/common/helpers/team-lock.js'
import {
  statusFragmentResponse,
  statusFragmentUnavailable,
  statusFragmentUrl,
  wantsStatusFragment
} from '#/server/common/helpers/status-fragment.js'
import { loadTeamForView, isNotFound } from '#/server/routes/teams/team-view.js'
import { environmentNotFound, teamNotFound } from './error-views.js'
import {
  isUnavailable,
  readTeamEnvironment,
  readTeamEnvironments,
  readTeamOperations,
  readTeamStatusChanges
} from './environments-api.js'
import {
  buildCards,
  buildEnvironmentPage,
  buildRecent,
  deployUrl,
  isDisabled
} from './environment-view.js'
import { buildOperationItem } from './operation-view.js'
import {
  RECENT_CHANGES,
  buildStatusChangeRows,
  mergeRecent
} from './recent-changes.js'
import { environmentHasRoom } from './federation-view.js'
import { federateUrl } from './federation-urls.js'

const OVERVIEW_TITLE = 'Environments and deployments'
const OVERVIEW_STATUS = 'environments/partials/overview-status'
const ENVIRONMENT_STATUS = 'environments/partials/environment-status'
// The most open changes one read returns (the backend's own limit).
const MOST_OPEN_CHANGES = 50
const NO_LOCK = { teamDisabled: false, disabledEnvironments: [] }

function unavailable(h, { what, backHref }) {
  return h
    .view('error/index', {
      pageTitle: 'Environments are not available just now',
      heading: 'Environments are not available just now',
      message: `We could not read ${what} just now. Try again in a moment.`,
      actionHref: backHref,
      actionText: 'Try again'
    })
    .code(statusCodes.serviceUnavailable)
}

// The backend says why: an environment this instance does not offer, or a team
// that is not the person's, which reads the same as one that does not exist.
function environmentOrTeamNotFound(h, error, slug) {
  return error.code === 'environment-not-available'
    ? environmentNotFound(h, slug)
    : teamNotFound(h)
}

// A read's outcome, however it went, so one that fails does not stop another.
function settled(read) {
  return Promise.allSettled([read]).then(([outcome]) => outcome)
}

function warnOnFailure(request, outcomes, message) {
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      request.logger.warn({ err: outcome.reason }, message)
    }
  }
}

function modelNamesOf(catalogue) {
  return Object.fromEntries(
    (catalogue.value?.items ?? []).map((model) => [
      model.slug,
      model.displayName
    ])
  )
}

function modelsBySlug(catalogue) {
  return Object.fromEntries(
    (catalogue.value?.items ?? []).map((model) => [model.slug, model])
  )
}

function itemsOf(outcome) {
  return outcome.status === 'fulfilled' ? outcome.value.items : null
}

// The team an `/environments` visit opens: the one the team switcher asked
// for (`?team=`), else the one last looked at, else the person's first. A
// slug that is not one of the person's teams is ignored.
function startingTeam(request, teams) {
  const asked = request.query.team ?? getEnvironmentsTeam(request)

  return teams.find((team) => team.slug === asked) ?? teams[0]
}

// The team switcher on the overview: only for a person with more than one
// team, with the current team selected.
function teamSwitcher(teams, current) {
  return teams && teams.length > 1
    ? {
        action: '/environments',
        items: teams.map((team) => ({
          value: team.slug,
          text: team.name,
          selected: team.slug === current.slug
        }))
      }
    : null
}

/**
 * The page or the status of a page for a read that was refused or failed, or
 * undefined when it went through. The refusal is the same whether the team
 * does not exist or the person is not a member (404, nothing about the team).
 * @param {unknown} error
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {{notFound: Function, what: string, backHref: string}} options
 */
function refusal(error, request, h, { notFound, what, backHref }) {
  if (isNotFound(error)) {
    return wantsStatusFragment(request)
      ? h.response().code(statusCodes.notFound)
      : notFound(h)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, `Could not read ${what}`)

    return wantsStatusFragment(request)
      ? statusFragmentUnavailable(h)
      : unavailable(h, { what, backHref })
  }

  throw error
}

async function loadOverview(request) {
  const { slug } = request.params
  const environments = await readTeamEnvironments(request, slug)
  const { team } = environments
  const client = apiClient(request)
  const [open, recent, statusChanges, catalogue, teams, loaded] =
    await Promise.all([
      settled(
        readTeamOperations(request, slug, {
          status: 'open',
          limit: MOST_OPEN_CHANGES
        })
      ),
      settled(
        readTeamOperations(request, slug, {
          status: 'recent',
          limit: RECENT_CHANGES
        })
      ),
      settled(readTeamStatusChanges(request, slug, { limit: RECENT_CHANGES })),
      settled(client.get('/v1/models?includeIneligible=true')),
      settled(client.get('/v1/teams')),
      settled(loadTeamForView(request, slug))
    ])

  warnOnFailure(
    request,
    [open, recent, statusChanges, catalogue, teams, loaded],
    'Could not read part of the environments overview'
  )

  const modelNames = modelNamesOf(catalogue)
  const openItems = itemsOf(open)
  const changesUnavailable =
    openItems === null ||
    itemsOf(recent) === null ||
    itemsOf(statusChanges) === null
  // A team whose lock could not be read is shown as it was before the lock:
  // the backend refuses a locked change whatever the page offered.
  const lock = loaded.status === 'fulfilled' ? loaded.value.lock : NO_LOCK
  const withLink = (item) => ({
    ...item,
    href: environmentPageUrl(team.slug, item.environment)
  })

  return {
    team,
    ...lockContext(lock),
    teamSwitcher: teamSwitcher(itemsOf(teams), team),
    ...federateOffer(team, environments.environments, lock),
    deployLocked: isDeployLocked(
      lock,
      defaultTeamEnvironment(),
      environments.environments.find(
        ({ environment }) => environment === defaultTeamEnvironment()
      )
    ),
    cards: buildCards({
      team,
      summaries: environments.environments,
      modelNames,
      lock
    }),
    changes: (openItems ?? []).map((operation) =>
      withLink(buildOperationItem(operation, { modelNames }))
    ),
    recent: mergeRecent(
      buildRecent(itemsOf(recent) ?? [], { modelNames }),
      buildStatusChangeRows(itemsOf(statusChanges) ?? []),
      RECENT_CHANGES
    ),
    changesUnavailable,
    inProgress:
      (openItems?.length ?? 0) > 0 ||
      environments.environments.some(({ inProgress }) => inProgress)
  }
}

// "Create Passwordless Credential" on the overview: a link while some
// environment with room is not disabled, a greyed button when every one with
// room is, and nothing when none has room.
function federateOffer(team, summaries, lock) {
  const withRoom = summaries.filter(environmentHasRoom)
  const open = withRoom.filter(
    (summary) => !isDisabled(lock, summary.environment, summary)
  )

  return {
    federateUrl: open.length > 0 ? federateUrl(team.slug) : null,
    federateLocked: withRoom.length > 0 && open.length === 0
  }
}

async function loadEnvironment(request, environment) {
  const { slug } = request.params
  const detail = await readTeamEnvironment(
    request,
    slug,
    environment.environment
  )
  const client = apiClient(request)
  const filters = { environment: environment.environment }
  // The detail has been answered, so the person is a member: the rest is read
  // together. The team is needed to know whether they are an admin.
  const [loaded, open, recent, statusChanges, catalogue] = await Promise.all([
    loadTeamForView(request, slug),
    settled(
      readTeamOperations(request, slug, {
        ...filters,
        status: 'open',
        limit: MOST_OPEN_CHANGES
      })
    ),
    settled(
      readTeamOperations(request, slug, {
        ...filters,
        status: 'recent',
        limit: RECENT_CHANGES
      })
    ),
    settled(
      readTeamStatusChanges(request, slug, {
        ...filters,
        limit: RECENT_CHANGES
      })
    ),
    settled(client.get('/v1/models?includeIneligible=true'))
  ])

  warnOnFailure(
    request,
    [open, recent, statusChanges, catalogue],
    'Could not read part of an environment page'
  )

  const { team, isAdmin, lock } = loaded
  const changesUnavailable =
    itemsOf(open) === null ||
    itemsOf(recent) === null ||
    itemsOf(statusChanges) === null
  const page = buildEnvironmentPage({
    team,
    isAdmin,
    environment,
    detail,
    operations: { open: itemsOf(open) ?? [], recent: itemsOf(recent) ?? [] },
    modelNames: modelNamesOf(catalogue),
    catalogue: modelsBySlug(catalogue),
    lock
  })

  return {
    ...page,
    recent: mergeRecent(
      page.recent,
      buildStatusChangeRows(itemsOf(statusChanges) ?? []),
      RECENT_CHANGES
    ),
    team,
    changesUnavailable
  }
}

/**
 * The Environments and deployments section: the person's teams, one team's
 * overview, and one environment of a team. Each address carries its team, and
 * every read is for that team alone, as its members; the backend answers 404
 * to anyone else.
 */
export const environmentsController = {
  list: {
    async handler(request, h) {
      let teams

      try {
        ;({ items: teams } = await apiClient(request).get('/v1/teams'))
      } catch (error) {
        return refusal(error, request, h, {
          notFound: teamNotFound,
          what: 'your teams',
          backHref: '/environments'
        })
      }

      if (teams.length === 0) {
        return h.view('environments/no-teams', {
          pageTitle: OVERVIEW_TITLE,
          heading: OVERVIEW_TITLE
        })
      }

      return h
        .redirect(teamEnvironmentsUrl(startingTeam(request, teams).slug))
        .code(statusCodes.seeOther)
    }
  },

  overview: {
    async handler(request, h) {
      const { slug } = request.params
      let view

      try {
        view = await loadOverview(request)
      } catch (error) {
        return refusal(error, request, h, {
          notFound: teamNotFound,
          what: 'this team’s environments',
          backHref: teamEnvironmentsUrl(slug)
        })
      }

      const pageUrl = teamEnvironmentsUrl(view.team.slug)
      const context = { ...view, pageUrl, showEnvironment: true }

      if (wantsStatusFragment(request)) {
        return statusFragmentResponse(request, h, OVERVIEW_STATUS, context)
      }

      setEnvironmentsTeam(request, view.team.slug)

      return h.view('environments/overview', {
        ...context,
        pageTitle: `${OVERVIEW_TITLE} - ${view.team.name}`,
        heading: OVERVIEW_TITLE,
        notification: takeAccountNotification(request),
        deployUrl: deployUrl(view.team),
        statusUrl: statusFragmentUrl(request.path)
      })
    }
  },

  environment: {
    async handler(request, h) {
      const { slug } = request.params
      const environment = environmentFromAddress(request.params.environment)

      if (!environment) {
        return environmentNotFound(h, slug)
      }

      let view

      try {
        view = await loadEnvironment(request, environment)
      } catch (error) {
        return refusal(error, request, h, {
          notFound: (toolkit) =>
            environmentOrTeamNotFound(toolkit, error, slug),
          what: 'this environment',
          backHref: environmentPageUrl(slug, environment.environment)
        })
      }

      const pageUrl = environmentPageUrl(
        view.team.slug,
        environment.environment
      )
      const context = { ...view, pageUrl, showEnvironment: false }

      if (wantsStatusFragment(request)) {
        return statusFragmentResponse(request, h, ENVIRONMENT_STATUS, context)
      }

      return h.view('environments/environment', {
        ...context,
        pageTitle: `${view.heading} - ${view.caption}`,
        overviewUrl: teamEnvironmentsUrl(view.team.slug),
        notification: takeAccountNotification(request),
        statusUrl: statusFragmentUrl(request.path)
      })
    }
  }
}

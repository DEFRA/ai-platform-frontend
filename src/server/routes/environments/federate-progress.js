import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  environmentPageUrl,
  environmentRegistryName,
  teamEnvironmentsUrl
} from '#/server/common/helpers/environment-names.js'
import {
  getRequestedFederations,
  getSessionUser
} from '#/server/common/helpers/session.js'
import {
  statusFragmentResponse,
  statusFragmentUnavailable,
  statusFragmentUrl,
  wantsStatusFragment
} from '#/server/common/helpers/status-fragment.js'
import { isNotFound } from '#/server/routes/teams/team-view.js'
import { loadTeamContext, unavailablePage } from './federation-context.js'
import { STEP } from './federation-journey.js'
import { federateUrl } from './federation-urls.js'
import { teamNotFound } from './error-views.js'
import { isUnavailable, readTeamOperation } from './environments-api.js'
import { buildOperationItem } from './operation-view.js'

const STATUS_PARTIAL = 'environments/partials/federate-status'

// What this person asked for just now for this team, or undefined: the
// session remembers it for the page that follows, and another person's, or
// another team's, is not theirs to follow.
function requestedFor(request, teamSlug) {
  const requested = getRequestedFederations(request)

  return requested?.userId === getSessionUser(request)?.id &&
    requested?.teamSlug === teamSlug
    ? requested
    : undefined
}

function environmentView(item, operation) {
  const view = buildOperationItem(operation, { modelNames: {} })

  return {
    environment: item.environment,
    name: environmentRegistryName(item.environment),
    steps: view.steps,
    failure: view.failure,
    open: view.open,
    ready:
      !view.open &&
      !view.failed &&
      view.steps.every(({ state }) => state === 'done')
  }
}

function headingOf({ name, inProgress, allReady }) {
  if (allReady) {
    return `${name} is federated`
  }

  return inProgress
    ? `Federating ${name}`
    : `We could not federate ${name} everywhere`
}

function readyList(team, environments) {
  return environments
    .filter(({ ready }) => ready)
    .map(({ environment, name }) => ({
      name,
      connectionUrl: `${environmentPageUrl(team.slug, environment)}#connection-details`,
      tokenUrl: `${environmentPageUrl(team.slug, environment)}#how-to-get-a-token`
    }))
}

// Each environment's operation, in the order they were asked for.
function readOperations(request, team, requested) {
  return Promise.all(
    requested.items.map((item) =>
      readTeamOperation(request, team.slug, item.operationId)
    )
  )
}

function refusal(error, request, h, team) {
  if (isNotFound(error)) {
    return wantsStatusFragment(request)
      ? h.response().code(statusCodes.notFound)
      : teamNotFound(h)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not read a federation')

    return wantsStatusFragment(request)
      ? statusFragmentUnavailable(h)
      : unavailablePage(h, {
          what: 'read how this is going',
          back: {
            href: federateUrl(team.slug, STEP.progress),
            text: 'Try again'
          }
        })
  }

  throw error
}

/**
 * The page that follows a federation: each environment's progress, one step
 * list for each, refreshing itself as the model request pages do; then, when
 * every environment is ready, a confirmation with the way to each one's
 * connection details, or, where one failed, why. Any member of the team can
 * see it.
 */
export const federateProgress = {
  get: {
    async handler(request, h) {
      const context = await loadTeamContext(request, h)

      if (context.page) {
        return context.page
      }

      const { team } = context
      const requested = requestedFor(request, team.slug)

      if (!requested) {
        return h
          .redirect(teamEnvironmentsUrl(team.slug))
          .code(statusCodes.seeOther)
      }

      let operations

      try {
        operations = await readOperations(request, team, requested)
      } catch (error) {
        return refusal(error, request, h, team)
      }

      const environments = operations.map((operation, index) =>
        environmentView(requested.items[index], operation)
      )
      const inProgress = environments.some(({ open }) => open)
      const allReady = environments.every(({ ready }) => ready)
      const pageUrl = federateUrl(team.slug, STEP.progress)
      const status = { environments, inProgress, pageUrl }

      if (wantsStatusFragment(request)) {
        return statusFragmentResponse(request, h, STATUS_PARTIAL, status)
      }

      const heading = headingOf({ name: requested.name, inProgress, allReady })

      return h.view('environments/federate-progress', {
        ...status,
        pageTitle: heading,
        heading,
        caption: team.name,
        applicationName: requested.name,
        allReady,
        environmentNames: environments.map(({ name }) => name).join(' and '),
        readyLinks: readyList(team, environments),
        overviewUrl: teamEnvironmentsUrl(team.slug),
        statusUrl: statusFragmentUrl(request.path)
      })
    }
  }
}

import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  environmentFromAddress,
  environmentPageUrl
} from '#/server/common/helpers/environment-names.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import { isNotFound } from '#/server/routes/teams/team-view.js'
import { environmentNotFound, errorPage, teamNotFound } from './error-views.js'
import {
  deleteTeamFederation,
  isUnavailable,
  readTeamEnvironment
} from './environments-api.js'
import { loadTeamContext, unavailablePage } from './federation-context.js'
import { HOSTS } from './federation-answers.js'
import { KIND, STEP, startPending } from './federation-journey.js'
import { federateUrl } from './federation-urls.js'

const READY = 'ready'
const FAILED = 'failed'
const ENVIRONMENT_NOT_AVAILABLE = 'environment-not-available'

function redirectTo(h, url) {
  return h.redirect(url).code(statusCodes.seeOther)
}

function backTo(team, environment) {
  return {
    href: environmentPageUrl(team.slug, environment.environment),
    text: `Back to ${environment.registryName}`
  }
}

function applicationNotFound(h, { team, environment }) {
  return errorPage(h, {
    status: statusCodes.notFound,
    heading: 'Application not found',
    message: `This application is not in ${environment.registryName}, or it has been removed.`,
    back: backTo(team, environment)
  })
}

function adminRequired(h, { team, environment }) {
  return errorPage(h, {
    status: statusCodes.forbidden,
    heading: 'You cannot change this application',
    message: `Only a team admin can change or remove an application in ${environment.registryName}.`,
    back: backTo(team, environment)
  })
}

function notNow(h, { team, environment, application }) {
  return errorPage(h, {
    status: statusCodes.conflict,
    heading: `${application.name} cannot be changed just now`,
    message:
      'An application can be changed once it is ready to use, and removed once it is ready or has failed. Wait for it to finish, then try again.',
    back: backTo(team, environment)
  })
}

// The page to show instead of the application, when the backend refused or
// failed reading the environment.
function readFailed(request, h, error, { team, slug, environment }) {
  if (isNotFound(error)) {
    return error.code === ENVIRONMENT_NOT_AVAILABLE
      ? environmentNotFound(h, slug)
      : teamNotFound(h)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not read an environment')

    return unavailablePage(h, {
      what: 'read this environment',
      back: {
        href: environmentPageUrl(team.slug, environment.environment),
        text: 'Try again'
      }
    })
  }

  throw error
}

/**
 * What an action on an application needs: the team, the environment and the
 * application in it, or the `page` to show instead. Only an admin changes or
 * removes an application, because that can cut off a running service; the
 * backend refuses a member too.
 */
async function load(request, h) {
  const { slug, id } = request.params
  const environment = environmentFromAddress(request.params.environment)

  if (!environment) {
    return { page: environmentNotFound(h, slug) }
  }

  const context = await loadTeamContext(request, h)

  if (context.page) {
    return context
  }

  const { team, isAdmin } = context

  if (!isAdmin) {
    return { page: adminRequired(h, { team, environment }) }
  }

  let detail

  try {
    detail = await readTeamEnvironment(
      request,
      team.slug,
      environment.environment
    )
  } catch (error) {
    return {
      page: readFailed(request, h, error, { team, slug, environment })
    }
  }

  const application = detail.applications?.items?.find((item) => item.id === id)

  return application
    ? { team, environment, application }
    : { page: applicationNotFound(h, { team, environment }) }
}

function startChange(request, { team, environment, application }) {
  const known = {
    kind: KIND.change,
    host: application.host,
    name: application.name,
    environments: [environment.environment],
    target: {
      environment: environment.environment,
      federationId: application.id,
      name: application.name
    }
  }

  return startPending(
    request,
    team.slug,
    application.host === HOSTS.cdp
      ? { ...known, service: application.service }
      : { ...known, principalId: application.principalId }
  )
}

function removeView(h, { team, environment, application, errorMessage }) {
  const heading = `Remove ${application.name} from ${environment.registryName}?`

  return h.view('environments/application-remove', {
    pageTitle: `${errorMessage ? 'Error: ' : ''}${heading}`,
    heading,
    caption: team.name,
    backLink: backTo(team, environment).href,
    cancelUrl: backTo(team, environment).href,
    applicationName: application.name,
    environmentName: environment.registryName,
    errorSummary: errorMessage ? [{ text: errorMessage }] : null
  })
}

function removeNotification({ environment, application }) {
  return {
    type: 'success',
    heading: `${application.name} is being removed from ${environment.registryName}`,
    message:
      'This usually takes a few minutes. You can follow it under Changes in progress.'
  }
}

// A removal the backend would not make, in words, or an error page for one the
// person cannot act on.
function removeFailed(request, h, error, context) {
  if (isNotFound(error)) {
    return applicationNotFound(h, context)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not remove an application')

    return removeView(h, {
      ...context,
      errorMessage:
        'We could not remove this application just now. Try again in a moment.'
    }).code(statusCodes.serviceUnavailable)
  }

  if (error.code === 'federation-in-progress') {
    return notNow(h, context)
  }

  if (error.code === 'admin-required') {
    return adminRequired(h, context)
  }

  throw error
}

function canRemove({ status }) {
  return status === READY || status === FAILED
}

/**
 * An admin's actions on one environment's application: Change, which asks the
 * Federate questions again from where the application is now, and Remove,
 * after a warning.
 */
export const applicationController = {
  change: {
    async handler(request, h) {
      const result = await load(request, h)

      if (result.page) {
        return result.page
      }

      if (result.application.status !== READY) {
        return notNow(h, result)
      }

      const pending = startChange(request, result)

      return redirectTo(
        h,
        federateUrl(
          result.team.slug,
          pending.host === HOSTS.cdp ? STEP.service : STEP.principalId
        )
      )
    }
  },
  remove: {
    get: {
      async handler(request, h) {
        const result = await load(request, h)

        if (result.page) {
          return result.page
        }

        return canRemove(result.application)
          ? removeView(h, result)
          : notNow(h, result)
      }
    },
    post: {
      async handler(request, h) {
        const result = await load(request, h)

        if (result.page) {
          return result.page
        }

        if (!canRemove(result.application)) {
          return notNow(h, result)
        }

        const { team, environment, application } = result

        try {
          await deleteTeamFederation(request, team.slug, {
            environment: environment.environment,
            federationId: application.id
          })
        } catch (error) {
          return removeFailed(request, h, error, result)
        }

        setAccountNotification(request, removeNotification(result))

        return redirectTo(h, backTo(team, environment).href)
      }
    }
  }
}

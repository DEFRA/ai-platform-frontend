import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  environmentPageUrl,
  environmentRegistryName
} from '#/server/common/helpers/environment-names.js'
import { cdpTrustText } from '#/server/common/helpers/cdp-environments.js'
import {
  clearPendingFederation,
  getSessionUser,
  setAccountNotification,
  setRequestedFederations
} from '#/server/common/helpers/session.js'
import { isNotFound } from '#/server/routes/teams/team-view.js'
import {
  HOSTS,
  applicationBody,
  confirmSchema,
  refusalText
} from './federation-answers.js'
import { loadTeamContext } from './federation-context.js'
import {
  applicationNameOf,
  refusedEnvironmentsView
} from './federate-environments.js'
import {
  KIND,
  STEP,
  backUrl,
  isAnswered,
  pendingFor
} from './federation-journey.js'
import { federateUrl } from './federation-urls.js'
import { environmentNotFound, errorPage, teamNotFound } from './error-views.js'
import {
  isUnavailable,
  patchTeamFederation,
  postTeamFederations
} from './environments-api.js'

const CHECK_HEADING = 'Check your answers'
const ENVIRONMENT_NOT_AVAILABLE = 'environment-not-available'

function redirectTo(h, url) {
  return h.redirect(url).code(statusCodes.seeOther)
}

function change(team, step) {
  return federateUrl(team.slug, step, { change: true })
}

function environmentLine(pending, environment) {
  const name = environmentRegistryName(environment)
  const trust = cdpTrustText(environment)

  return pending.host === HOSTS.cdp && trust
    ? `${name}, which trusts ${trust}`
    : name
}

// The answers as the check page lists them. An addition lists where it runs,
// the application and the environments, each with Change (except the
// environments when only one was offered); a change lists its environment and
// the new values.
function answerRows(team, pending) {
  const isAdd = pending.kind === KIND.add
  const rows = []

  if (isAdd) {
    rows.push({
      key: 'Runs on',
      value: pending.host === HOSTS.cdp ? 'CDP' : 'Azure',
      changeUrl: change(team, STEP.where),
      changeId: 'change-host',
      hidden: 'where it runs'
    })
  } else {
    rows.push({
      key: 'Environment',
      value: environmentRegistryName(pending.target.environment)
    })
  }

  if (pending.host === HOSTS.cdp) {
    rows.push({
      key: 'CDP service',
      value: pending.service,
      changeUrl: change(team, STEP.service),
      changeId: 'change-service',
      hidden: 'the CDP service'
    })
  } else {
    rows.push(
      {
        key: 'Principal ID',
        value: pending.principalId,
        changeUrl: change(team, STEP.principalId),
        changeId: 'change-principalId',
        hidden: 'the principal ID'
      },
      {
        key: 'Name',
        value: pending.name,
        changeUrl: change(team, STEP.name),
        changeId: 'change-name',
        hidden: 'the name'
      }
    )
  }

  if (isAdd) {
    rows.push({
      key: pending.environments.length > 1 ? 'Environments' : 'Environment',
      lines: pending.environments.map((environment) =>
        environmentLine(pending, environment)
      ),
      changeUrl: pending.environmentsSkipped
        ? null
        : change(team, STEP.environments),
      changeId: 'change-environments',
      hidden: 'the environments'
    })
  }

  return rows
}

function environmentNames(pending) {
  return pending.environments
    .map((environment) => environmentRegistryName(environment))
    .join(' and ')
}

function checkView(h, { team, pending, errorMessage }) {
  const isAdd = pending.kind === KIND.add
  const name = applicationNameOf(pending)
  const target = pending.target ?? {}
  const environments = environmentNames(pending)
  const rows = answerRows(team, pending)
  const firstChange = rows.find((row) => row.changeUrl)

  return h.view('environments/federate-check', {
    pageTitle: `${errorMessage ? 'Error: ' : ''}${CHECK_HEADING}`,
    heading: CHECK_HEADING,
    caption: team.name,
    backLink: backUrl(team, pending, STEP.check),
    rows,
    // The key of the answers shown, posted back with the confirmation.
    key: pending.key,
    errorSummary: errorMessage
      ? [{ text: errorMessage, href: `#${firstChange.changeId}` }]
      : null,
    isAdd,
    nowHeading: isAdd
      ? `Now create a passwordless credential for ${name}`
      : `Now change ${target.name}`,
    nowText: isAdd
      ? `${name} will get ${team.name}’s access to every model in ${environments}.`
      : `This replaces ${target.name}’s passwordless credential in ${environments}. Its client ID and your team’s access stay the same.`,
    buttonText: isAdd
      ? 'Create Passwordless Credential'
      : `Change ${target.name}`
  })
}

// The request's answers as the backend wants them for a change: a CDP
// application's service, or an Azure one's principal ID and name.
function changeBody(pending) {
  return pending.host === HOSTS.cdp
    ? { service: pending.service }
    : { principalId: pending.principalId, name: pending.name }
}

async function makeRequest(request, { team, pending }) {
  if (pending.kind === KIND.change) {
    return patchTeamFederation(
      request,
      team.slug,
      pending.target,
      changeBody(pending),
      pending.key
    )
  }

  return postTeamFederations(
    request,
    team.slug,
    applicationBody(pending, pending.environments),
    pending.key
  )
}

function changeNotification(pending) {
  const environment = environmentRegistryName(pending.target.environment)

  return {
    type: 'success',
    heading: `${pending.target.name} is being changed in ${environment}`,
    message:
      'This usually takes a few minutes. You can follow it under Changes in progress.'
  }
}

// What a request that went through leads to: an addition to the page that
// follows its operations, a change to the environment's page.
function succeeded(request, h, { team, pending, answer }) {
  clearPendingFederation(request)

  if (pending.kind === KIND.change) {
    setAccountNotification(request, changeNotification(pending))

    return redirectTo(
      h,
      environmentPageUrl(team.slug, pending.target.environment)
    )
  }

  setRequestedFederations(request, {
    userId: getSessionUser(request).id,
    teamSlug: team.slug,
    name: applicationNameOf(pending),
    items: answer.federations.map(({ environment, operationId }) => ({
      environment,
      operationId
    }))
  })

  return redirectTo(h, federateUrl(team.slug, STEP.progress))
}

function environmentBack(team, pending) {
  const environment = pending.target?.environment

  return environment
    ? {
        href: environmentPageUrl(team.slug, environment),
        text: `Back to ${environmentRegistryName(environment)}`
      }
    : { href: federateUrl(team.slug), text: 'Start again' }
}

// Refusals that leave the answers to be corrected, said on the check page.
function refusedChange(h, error, { team, pending }) {
  const environmentName = environmentRegistryName(pending.target.environment)
  const name = applicationNameOf(pending)
  const messages = {
    'federation-unchanged': `These are the same as ${pending.target.name} has now. Change them, or go back.`,
    'federation-exists': refusalText(error.code, { name, environmentName }),
    'federation-trusted-elsewhere': refusalText(error.code, {
      name,
      environmentName
    })
  }

  return checkView(h, {
    team,
    pending,
    errorMessage: messages[error.code]
  }).code(statusCodes.conflict)
}

const CHANGE_REFUSALS = new Set([
  'federation-unchanged',
  'federation-exists',
  'federation-trusted-elsewhere'
])

// A request the backend would not make, in words, or an error page for one the
// person cannot act on. A key the backend has refused as reused is spent, so
// the answers go with it.
async function failed(request, h, error, { team, pending }) {
  if (isNotFound(error)) {
    return error.code === ENVIRONMENT_NOT_AVAILABLE
      ? environmentNotFound(h, team.slug)
      : teamNotFound(h)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not make the federation')

    return checkView(h, {
      team,
      pending,
      errorMessage:
        'We could not make this change just now. Check your answers and try again.'
    }).code(statusCodes.serviceUnavailable)
  }

  if (error.code === 'federation-refused' && error.environments?.length) {
    return refusedEnvironmentsView(request, h, {
      team,
      pending,
      refusals: error.environments
    })
  }

  if (pending.kind === KIND.change && CHANGE_REFUSALS.has(error.code)) {
    return refusedChange(h, error, { team, pending })
  }

  return otherRefusal(request, h, error, { team, pending })
}

function otherRefusal(request, h, error, { team, pending }) {
  const back = environmentBack(team, pending)

  if (error.code === 'idempotency-key-reused') {
    clearPendingFederation(request)

    return errorPage(h, {
      status: statusCodes.conflict,
      heading: 'Check your answers again',
      message:
        'Something changed since you checked these answers. Check your answers again.',
      back: { href: federateUrl(team.slug), text: 'Start again' }
    })
  }

  const pages = {
    'admin-required': {
      status: statusCodes.forbidden,
      heading: 'You cannot change this application',
      message: 'Only a team admin can change or remove an application.'
    },
    'federation-in-progress': {
      status: statusCodes.conflict,
      heading: 'This application is still changing',
      message:
        'It is being set up or removed. Wait for that to finish, then try again.'
    },
    'environment-not-set-up': {
      status: statusCodes.conflict,
      heading: 'This environment is not set up yet',
      message:
        'Deploy a model in the environment first, so it has a registration to add the application to.'
    }
  }

  if (pages[error.code]) {
    return errorPage(h, { ...pages[error.code], back })
  }

  throw error
}

/**
 * The last page of the Federate journey: the answers to check, then one
 * request for them. An addition makes one operation for each environment
 * chosen; a change (an admin's) makes one. The key shown with the answers is
 * posted back, so a second window cannot confirm what this one did not show.
 */
export const federateCheck = {
  get: {
    async handler(request, h) {
      const context = await loadTeamContext(request, h)

      if (context.page) {
        return context.page
      }

      const { team } = context
      const pending = pendingFor(request, team.slug)

      return isAnswered(pending)
        ? checkView(h, { team, pending })
        : redirectTo(h, federateUrl(team.slug))
    }
  },
  post: {
    options: {
      validate: {
        payload: confirmSchema,
        // A key that is not text (a forged or repeated field) gets the check
        // page again, with the answers now held and their key, and no request.
        async failAction(request, h) {
          const context = await loadTeamContext(request, h)

          if (context.page) {
            return context.page.takeover()
          }

          const pending = pendingFor(request, context.team.slug)

          return (
            isAnswered(pending)
              ? checkView(h, {
                  team: context.team,
                  pending,
                  errorMessage:
                    'We could not read your answers. Check the answers shown, then try again.'
                }).code(statusCodes.badRequest)
              : redirectTo(h, federateUrl(context.team.slug))
          ).takeover()
        }
      }
    },
    async handler(request, h) {
      const context = await loadTeamContext(request, h)

      if (context.page) {
        return context.page
      }

      const { team } = context
      const pending = pendingFor(request, team.slug)

      if (!isAnswered(pending)) {
        return redirectTo(h, federateUrl(team.slug))
      }

      // The answers are shared by every window of the session, so what is
      // confirmed is what this page showed, not whatever was answered last.
      if (request.payload.key !== pending.key) {
        return checkView(h, {
          team,
          pending,
          errorMessage:
            'Your answers changed in another window. Check the answers shown now, then try again.'
        }).code(statusCodes.conflict)
      }

      try {
        const answer = await makeRequest(request, { team, pending })

        return succeeded(request, h, { team, pending, answer })
      } catch (error) {
        return failed(request, h, error, { team, pending })
      }
    }
  }
}

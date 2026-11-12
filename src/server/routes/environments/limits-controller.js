import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from '#/server/common/helpers/api-client.js'
import {
  environmentFromAddress,
  environmentPageUrl,
  teamEnvironmentsUrl
} from '#/server/common/helpers/environment-names.js'
import {
  clearPendingLimits,
  getPendingLimits,
  getSessionUser,
  setAccountNotification,
  setPendingLimits
} from '#/server/common/helpers/session.js'
import { isNotFound, loadTeamForView } from '#/server/routes/teams/team-view.js'
import {
  isMissing,
  isUnavailable,
  putTeamLimits,
  readTeamEnvironment
} from './environments-api.js'
import { parseLimits } from './limits-answers.js'

const numberFormat = new Intl.NumberFormat('en-GB')

const answersSchema = Joi.object({
  tokensPerMinute: Joi.string().allow('').default(''),
  requestsPerMinute: Joi.string().allow('').default('')
})

function limitsUrl(slug, environment) {
  return `${environmentPageUrl(slug, environment)}/limits`
}

function errorPage(h, { status, heading, message, back }) {
  return h
    .view('error/index', {
      pageTitle: heading,
      heading,
      message,
      actionHref: back.href,
      actionText: back.text
    })
    .code(status)
}

function teamNotFound(h) {
  return errorPage(h, {
    status: statusCodes.notFound,
    heading: 'Team not found',
    message: 'This team does not exist, or you are not a member.',
    back: { href: '/environments', text: 'Go to your environments' }
  })
}

function environmentNotFound(h, slug) {
  return errorPage(h, {
    status: statusCodes.notFound,
    heading: 'Environment not found',
    message: 'This environment does not exist or is not available yet.',
    back: { href: teamEnvironmentsUrl(slug), text: 'Back to all environments' }
  })
}

function adminRequired(h, { slug, environment }) {
  return errorPage(h, {
    status: statusCodes.forbidden,
    heading: 'You cannot change the limits',
    message: `Only a team admin can change the limits in ${environment.registryName}.`,
    back: {
      href: environmentPageUrl(slug, environment.environment),
      text: `Back to ${environment.registryName}`
    }
  })
}

function notSetUp(h, { slug, environment }) {
  return errorPage(h, {
    status: statusCodes.conflict,
    heading: `${environment.registryName} is not set up yet`,
    message: `${environment.registryName} is not set up yet, so it has no limits to change.`,
    back: {
      href: environmentPageUrl(slug, environment.environment),
      text: `Back to ${environment.registryName}`
    }
  })
}

function unavailable(h, { slug, environment }) {
  return errorPage(h, {
    status: statusCodes.serviceUnavailable,
    heading: 'Environments are not available just now',
    message:
      'We could not read this environment just now. Try again in a moment.',
    back: {
      href: limitsUrl(slug, environment.environment),
      text: 'Try again'
    }
  })
}

/**
 * What a limits page needs before it can show: the environment, what the
 * backend holds of it (for its bounds and current limits) and whether the
 * person is an admin. `page` is what to show instead when any of it is not
 * there or not theirs: the same 404 for a team that is not theirs as for one
 * that does not exist, 403 for a member, 409 for an environment never set up.
 */
async function load(request, h) {
  const { slug } = request.params
  const environment = environmentFromAddress(request.params.environment)

  if (!environment) {
    return { page: environmentNotFound(h, slug) }
  }

  let detail
  let loaded

  try {
    detail = await readTeamEnvironment(request, slug, environment.environment)
    loaded = await loadTeamForView(request, slug)
  } catch (error) {
    if (isMissing(error) || isNotFound(error)) {
      return {
        page:
          error.code === 'environment-not-available'
            ? environmentNotFound(h, slug)
            : teamNotFound(h)
      }
    }

    if (isUnavailable(error)) {
      request.logger.warn({ err: error }, 'Could not read an environment')

      return { page: unavailable(h, { slug, environment }) }
    }

    throw error
  }

  if (!loaded.isAdmin) {
    return { page: adminRequired(h, { slug, environment }) }
  }

  if (!detail.limitBounds) {
    return { page: notSetUp(h, { slug, environment }) }
  }

  return { team: loaded.team, environment, detail }
}

// The answers this person has given for this team and environment and not yet
// confirmed. An answer left by anyone else, or for anything else, is not theirs
// to confirm.
function pendingFor(request, { team, environment }) {
  const pending = getPendingLimits(request)

  return pending &&
    pending.userId === getSessionUser(request)?.id &&
    pending.teamSlug === team.slug &&
    pending.environment === environment.environment
    ? pending
    : undefined
}

function currentLimits(detail) {
  return detail.pendingLimits ?? detail.limits
}

function hint(field, { bounds, detail }) {
  const { min, max } = bounds[field]
  const range = `Between ${numberFormat.format(min)} and ${numberFormat.format(max)}.`

  if (detail.pendingLimits) {
    return `${range} Your team is changing to ${numberFormat.format(detail.pendingLimits[field])}.`
  }

  return `${range} Your team has ${numberFormat.format(detail.limits[field])} now.`
}

function questionView(h, { team, environment, detail, pending, problems }) {
  const heading = `Change the limits in ${environment.registryName}`
  const current = currentLimits(detail)
  const values = problems?.values ?? {
    tokensPerMinute: String(
      pending?.tokensPerMinute ?? current.tokensPerMinute
    ),
    requestsPerMinute: String(
      pending?.requestsPerMinute ?? current.requestsPerMinute
    )
  }
  const bounds = detail.limitBounds

  return h.view('environments/limits', {
    pageTitle: `${problems ? 'Error: ' : ''}${heading}`,
    heading,
    teamName: team.name,
    backLink: environmentPageUrl(team.slug, environment.environment),
    values,
    hints: {
      tokensPerMinute: hint('tokensPerMinute', { bounds, detail }),
      requestsPerMinute: hint('requestsPerMinute', { bounds, detail })
    },
    errorSummary: problems?.errorSummary ?? null,
    fieldErrors: problems?.fieldErrors ?? {}
  })
}

function checkView(h, { team, environment, pending, errorMessage }) {
  const url = limitsUrl(team.slug, environment.environment)

  return h.view('environments/limits-check', {
    pageTitle: `${errorMessage ? 'Error: ' : ''}Check your answers`,
    heading: 'Check your answers',
    teamName: team.name,
    backLink: url,
    errorSummary: errorMessage ? [{ text: errorMessage }] : null,
    rows: [
      { key: 'Environment', value: environment.registryName },
      {
        key: 'Tokens a minute',
        value: numberFormat.format(pending.tokensPerMinute),
        changeUrl: url,
        hidden: 'tokens a minute'
      },
      {
        key: 'Requests a minute',
        value: numberFormat.format(pending.requestsPerMinute),
        changeUrl: url,
        hidden: 'requests a minute'
      }
    ]
  })
}

function limitsChangedNotification(environment) {
  return {
    type: 'success',
    heading: `The limits in ${environment.registryName} are being changed`,
    message:
      'This usually takes a few minutes. You can follow it under Changes in progress.'
  }
}

// What a refusal of the change says, and where it leaves the person. The
// backend's own bounds are used when it sends them, so the page states the
// bounds that were checked.
function refusal(h, error, context) {
  const { team, environment, detail, pending } = context
  const slug = team.slug

  if (error.code === 'limits-out-of-bounds') {
    const { problems } = parseLimits(
      pending,
      error.limitBounds ?? detail.limitBounds
    )

    return questionView(h, {
      ...context,
      problems: problems ?? {
        values: {
          tokensPerMinute: String(pending.tokensPerMinute),
          requestsPerMinute: String(pending.requestsPerMinute)
        },
        errorSummary: [
          {
            text: 'The limits are outside the bounds for this environment',
            href: '#tokensPerMinute'
          }
        ],
        fieldErrors: {}
      }
    }).code(statusCodes.badRequest)
  }

  if (error.code === 'limits-unchanged') {
    return checkView(h, {
      team,
      environment,
      pending,
      errorMessage: `Your team already has these limits in ${environment.registryName}. Change them, or go back.`
    }).code(statusCodes.conflict)
  }

  if (error.code === 'environment-not-set-up') {
    return notSetUp(h, { slug, environment })
  }

  if (error.code === 'admin-required') {
    return adminRequired(h, { slug, environment })
  }

  if (error.code === 'idempotency-key-reused') {
    return errorPage(h, {
      status: statusCodes.conflict,
      heading: 'Check your answers again',
      message:
        'Something changed since you checked these limits. Check your answers again.',
      back: {
        href: limitsUrl(slug, environment.environment),
        text: 'Change the limits'
      }
    })
  }

  return null
}

/**
 * An admin changes a team's limits in one environment: the question, a check
 * of the answers, then one change to the team's file. The answers are checked
 * against the bounds here to say what is wrong in words, and again by the
 * backend, which is the check that counts. Members are told they cannot; the
 * backend refuses them too.
 */
export const limitsController = {
  question: {
    get: {
      async handler(request, h) {
        const result = await load(request, h)

        return (
          result.page ??
          questionView(h, {
            ...result,
            pending: pendingFor(request, result)
          })
        )
      }
    },
    post: {
      options: {
        validate: {
          payload: answersSchema,
          failAction: (request, h) =>
            h.response().code(statusCodes.badRequest).takeover()
        }
      },
      async handler(request, h) {
        const result = await load(request, h)

        if (result.page) {
          return result.page
        }

        const { limits, problems } = parseLimits(
          request.payload,
          result.detail.limitBounds
        )

        if (problems) {
          return questionView(h, { ...result, problems }).code(
            statusCodes.badRequest
          )
        }

        // A new key for each set of answers: asking again with the same
        // answers is the same request, different answers are a new one.
        setPendingLimits(request, {
          ...limits,
          userId: getSessionUser(request).id,
          teamSlug: result.team.slug,
          environment: result.environment.environment,
          key: randomUUID()
        })

        return h
          .redirect(
            `${limitsUrl(result.team.slug, result.environment.environment)}/check`
          )
          .code(statusCodes.seeOther)
      }
    }
  },

  check: {
    get: {
      async handler(request, h) {
        const result = await load(request, h)

        if (result.page) {
          return result.page
        }

        const pending = pendingFor(request, result)

        if (!pending) {
          return h
            .redirect(
              limitsUrl(result.team.slug, result.environment.environment)
            )
            .code(statusCodes.seeOther)
        }

        return checkView(h, { ...result, pending })
      }
    },
    post: {
      async handler(request, h) {
        const result = await load(request, h)

        if (result.page) {
          return result.page
        }

        const { team, environment } = result
        const pending = pendingFor(request, result)

        if (!pending) {
          return h
            .redirect(limitsUrl(team.slug, environment.environment))
            .code(statusCodes.seeOther)
        }

        try {
          await putTeamLimits(
            request,
            team.slug,
            environment.environment,
            {
              tokensPerMinute: pending.tokensPerMinute,
              requestsPerMinute: pending.requestsPerMinute
            },
            pending.key
          )
        } catch (error) {
          return failed(request, h, error, { ...result, pending })
        }

        clearPendingLimits(request)
        setAccountNotification(request, limitsChangedNotification(environment))

        return h
          .redirect(environmentPageUrl(team.slug, environment.environment))
          .code(statusCodes.seeOther)
      }
    }
  }
}

// A change the backend would not make, in words, or an error page for one the
// person cannot act on. A key the backend has refused as reused is spent, so
// the answers go with it.
function failed(request, h, error, context) {
  if (!(error instanceof ApiError)) {
    throw error
  }

  if (isMissing(error)) {
    return teamNotFound(h)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not change the limits')

    return checkView(h, {
      ...context,
      errorMessage:
        'We could not change the limits just now. Check your answers and try again.'
    }).code(statusCodes.serviceUnavailable)
  }

  if (error.code === 'idempotency-key-reused') {
    clearPendingLimits(request)
  }

  const page = refusal(h, error, context)

  if (page) {
    return page
  }

  throw error
}

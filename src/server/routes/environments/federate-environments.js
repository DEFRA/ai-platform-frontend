import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  environmentRegistryName,
  teamEnvironmentList,
  teamEnvironmentsUrl
} from '#/server/common/helpers/environment-names.js'
import { cdpTrustText } from '#/server/common/helpers/cdp-environments.js'
import {
  changeQuerySchema,
  isChange
} from '#/server/routes/connect/team-journey.js'
import { isNotFound } from '#/server/routes/teams/team-view.js'
import {
  HOSTS,
  applicationBody,
  environmentsSchema,
  refusalText
} from './federation-answers.js'
import { loadTeamContext, unavailablePage } from './federation-context.js'
import {
  KIND,
  STEP,
  backUrl,
  pendingFor,
  savePending,
  stepAfter
} from './federation-journey.js'
import { federateUrl } from './federation-urls.js'
import { errorPage, teamNotFound } from './error-views.js'
import { checkTeamFederation, isUnavailable } from './environments-api.js'

const querySchema = { query: changeQuerySchema }
const SELECT_FROM_LIST = 'Select environments from the list'
// An environment that is not offered says why in the hint, not as a choice.
const NOT_OFFERED = new Set([
  'environment-not-available',
  'environment-not-set-up',
  'federation-limit-reached'
])

function redirectTo(h, url) {
  return h.redirect(url).code(statusCodes.seeOther)
}

export function applicationNameOf(pending) {
  return pending.host === HOSTS.cdp ? pending.service : pending.name
}

// The environments are asked about once the application is named.
function isNamed(pending) {
  return Boolean(
    pending?.kind === KIND.add &&
    (pending.host === HOSTS.cdp
      ? pending.service
      : pending.principalId && pending.name)
  )
}

/**
 * What each environment the team can use says to the application: the
 * backend's dry run, in one call. An environment it will not take at all is
 * not offered; one that refuses this application is offered, and refuses it
 * with its reason when chosen.
 * @returns {Promise<{codes: Map<string, string | null>, offered: string[]}>}
 */
async function loadChoices(request, team, pending) {
  const candidates = teamEnvironmentList()
    .filter(({ available }) => available)
    .map(({ environment }) => environment)
  const { environments } = await checkTeamFederation(
    request,
    team.slug,
    applicationBody(pending, candidates)
  )
  const codes = new Map(
    environments.map(({ environment, code }) => [environment, code])
  )

  return {
    codes,
    offered: candidates.filter(
      (environment) => !NOT_OFFERED.has(codes.get(environment))
    )
  }
}

// A refusal's words for each environment, as an error summary linked to the
// first checkbox and the one message under the question.
function problemFrom(refusals, pending) {
  const name = applicationNameOf(pending)
  const texts = refusals.map(({ environment, code }) =>
    refusalText(code, {
      name,
      environmentName: environmentRegistryName(environment)
    })
  )

  return {
    errorSummary: texts.map((text) => ({ text, href: '#environments' })),
    fieldErrors: { environments: { text: texts.join('. ') } }
  }
}

function hintFor(pending, environment) {
  const name = applicationNameOf(pending)
  const trust = cdpTrustText(environment)

  return pending.host === HOSTS.cdp && trust
    ? `Trusts ${name} in ${trust}`
    : `Trusts ${name} from the Defra tenant`
}

function environmentsView(
  h,
  { request, team, pending, offered, selected, problem }
) {
  const name = applicationNameOf(pending)
  const heading = `Which environments should trust ${name}?`

  return h.view('environments/federate-environments', {
    pageTitle: `${problem ? 'Error: ' : ''}${heading}`,
    heading,
    caption: team.name,
    backLink: isChange(request)
      ? federateUrl(team.slug, STEP.check)
      : backUrl(team, pending, STEP.environments),
    items: offered.map((environment) => ({
      value: environment,
      text: environmentRegistryName(environment),
      hint: { text: hintFor(pending, environment) },
      checked: selected.includes(environment)
    })),
    errorSummary: problem?.errorSummary ?? null,
    fieldErrors: problem?.fieldErrors ?? {}
  })
}

function nothingOffered(h, team, pending) {
  return errorPage(h, {
    status: statusCodes.conflict,
    heading: `${applicationNameOf(pending)} cannot be federated anywhere just now`,
    message:
      'Your team has no environment set up with room for another application. Set one up, or remove an application you no longer use.',
    back: {
      href: teamEnvironmentsUrl(team.slug),
      text: 'Back to all environments'
    }
  })
}

// The choices, or the page to show instead when the backend could not give
// them: a 404 reads the same as an unknown team, a failure as unavailable.
async function choicesOrPage(request, h, { team, pending }) {
  try {
    return await loadChoices(request, team, pending)
  } catch (error) {
    if (isNotFound(error)) {
      return { page: teamNotFound(h) }
    }

    if (isUnavailable(error)) {
      request.logger.warn({ err: error }, 'Could not check the environments')

      return {
        page: unavailablePage(h, {
          what: 'check the environments',
          back: {
            href: federateUrl(team.slug, STEP.environments),
            text: 'Try again'
          }
        })
      }
    }

    throw error
  }
}

// What the person ticked before, or the environment the journey started from.
function initialSelection(pending, offered) {
  const held = (pending.environments ?? []).filter((environment) =>
    offered.includes(environment)
  )

  if (held.length > 0) {
    return held
  }

  return offered.includes(pending.start) ? [pending.start] : []
}

function refusalsOf(offered, codes) {
  return offered
    .filter((environment) => codes.get(environment))
    .map((environment) => ({ environment, code: codes.get(environment) }))
}

// What is wrong with the environments chosen, if anything. The form only
// posts what it offered, so one the dry run did not answer for is a stale page
// or a forged request; one that refuses the application says why.
function problemOfChoice(environments, { codes, pending }) {
  if (environments.some((environment) => !codes.has(environment))) {
    return {
      errorSummary: [{ text: SELECT_FROM_LIST, href: '#environments' }],
      fieldErrors: { environments: { text: SELECT_FROM_LIST } }
    }
  }

  const refusals = refusalsOf(environments, codes)

  return refusals.length > 0 ? problemFrom(refusals, pending) : undefined
}

/**
 * The environments question again, with the reasons the backend refused the
 * application in some of them when it was confirmed (a refusal that arose
 * since the dry run). Nothing was queued.
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {{team: object, pending: object, refusals: Array<{environment: string, code: string}>}} context
 * @returns {Promise<import('@hapi/hapi').ResponseObject>}
 */
export async function refusedEnvironmentsView(
  request,
  h,
  { team, pending, refusals }
) {
  const choices = await choicesOrPage(request, h, { team, pending })

  if (choices.page) {
    return choices.page
  }

  return environmentsView(h, {
    request,
    team,
    pending,
    // An environment that refused is listed even if the dry run no longer
    // offers it, so its reason sits beside what was chosen.
    offered: [
      ...new Set([
        ...choices.offered,
        ...refusals.map(({ environment }) => environment)
      ])
    ],
    selected: pending.environments,
    problem: problemFrom(refusals, pending)
  }).code(statusCodes.conflict)
}

// Everything the page needs: the team, the journey and the choices, or the
// page to show instead.
async function loadStep(request, h) {
  const context = await loadTeamContext(request, h)

  if (context.page) {
    return context
  }

  const pending = pendingFor(request, context.team.slug)

  if (!isNamed(pending)) {
    return { page: redirectTo(h, federateUrl(context.team.slug)) }
  }

  const choices = await choicesOrPage(request, h, { ...context, pending })

  return choices.page ? choices : { ...context, ...choices, pending }
}

/**
 * Which environments should trust the application: the team's available
 * environments whose registration has room, the one the journey started from
 * ticked. Skipped when only one is offered and it takes the application. Each
 * chosen environment is checked, and one that refuses it says why, naming that
 * environment and never another team.
 */
export const federateEnvironments = {
  get: {
    options: { validate: querySchema },
    async handler(request, h) {
      const step = await loadStep(request, h)

      if (step.page) {
        return step.page
      }

      const { team, pending, offered, codes } = step

      if (offered.length === 0) {
        return nothingOffered(h, team, pending)
      }

      const refusals = refusalsOf(offered, codes)

      if (offered.length === 1 && refusals.length === 0 && !isChange(request)) {
        savePending(request, team.slug, {
          environments: offered,
          environmentsSkipped: true
        })

        return redirectTo(h, federateUrl(team.slug, STEP.check))
      }

      // Alone, an environment that refuses has nothing else to be chosen
      // instead, so it says why before anything is ticked.
      return environmentsView(h, {
        request,
        team,
        pending,
        offered,
        selected: initialSelection(pending, offered),
        problem:
          offered.length === 1 && refusals.length > 0
            ? problemFrom(refusals, pending)
            : undefined
      })
    }
  },
  post: {
    options: {
      validate: {
        ...querySchema,
        payload: environmentsSchema,
        async failAction(request, h, error) {
          const step = await loadStep(request, h)

          if (step.page) {
            return step.page.takeover()
          }

          // A problem with one of the items is a problem with the question:
          // both link to the first checkbox.
          const text = error.details[0].message

          return environmentsView(h, {
            request,
            ...step,
            selected: [request.payload.environments ?? []].flat(),
            problem: {
              errorSummary: [{ text, href: '#environments' }],
              fieldErrors: { environments: { text } }
            }
          })
            .code(statusCodes.badRequest)
            .takeover()
        }
      }
    },
    async handler(request, h) {
      const step = await loadStep(request, h)

      if (step.page) {
        return step.page
      }

      const { team, pending, offered, codes } = step
      const { environments } = request.payload
      const problem = problemOfChoice(environments, { codes, pending })

      if (problem) {
        return environmentsView(h, {
          request,
          team,
          pending,
          offered,
          selected: environments.filter((environment) =>
            offered.includes(environment)
          ),
          problem
        }).code(statusCodes.badRequest)
      }

      const saved = savePending(request, team.slug, {
        environments,
        environmentsSkipped: false
      })

      return redirectTo(
        h,
        federateUrl(team.slug, stepAfter(saved, STEP.environments))
      )
    }
  }
}

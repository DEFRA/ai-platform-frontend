import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  environmentFromAddress,
  environmentRegistryName
} from '#/server/common/helpers/environment-names.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  changeQuerySchema,
  isChange
} from '#/server/routes/connect/team-journey.js'
import {
  HOSTS,
  hostSchema,
  nameSchema,
  principalIdSchema,
  serviceSchema
} from './federation-answers.js'
import { loadTeamContext } from './federation-context.js'
import {
  KIND,
  STEP,
  backUrl,
  isAnswered,
  pendingFor,
  savePending,
  startPending,
  stepAfter
} from './federation-journey.js'
import { federateUrl } from './federation-urls.js'

const querySchema = { query: changeQuerySchema }
const WHERE_HEADING = 'Where does your application run?'

// The questions that take one piece of text, each for one host.
const TEXT_STEPS = {
  [STEP.service]: {
    field: 'service',
    host: HOSTS.cdp,
    schema: serviceSchema,
    heading: 'What is your CDP service called?',
    hint: 'Its repository name: lower-case letters, numbers and single hyphens, up to 32 characters.'
  },
  [STEP.principalId]: {
    field: 'principalId',
    host: HOSTS.azure,
    schema: principalIdSchema,
    heading: 'What is the managed identity’s principal ID?',
    hint: 'The principal ID of a user-assigned managed identity in the Defra tenant, like 00000000-0000-0000-0000-000000000000. A system-assigned identity cannot be used.'
  },
  [STEP.name]: {
    field: 'name',
    host: HOSTS.azure,
    schema: nameSchema,
    heading: 'What do you want to call this application?',
    hint: 'Lower-case letters, numbers and hyphens, up to 63 characters. For example, flood-reports.'
  }
}

function redirectTo(h, url) {
  return h.redirect(url).code(statusCodes.seeOther)
}

// Where the person goes after answering: back to the check page when they came
// from it and every answer is there, else on to the next question.
function nextUrl(request, team, pending, step) {
  const next =
    isChange(request) && isAnswered(pending)
      ? STEP.check
      : stepAfter(pending, step)

  return federateUrl(team.slug, next)
}

// A page's Back link: the check page when the question was opened from it.
function backLinkOf(request, team, pending, step) {
  return isChange(request) && isAnswered(pending)
    ? federateUrl(team.slug, STEP.check)
    : backUrl(team, pending, step)
}

// The environment a journey is started from (an environment page's link),
// when this instance offers it.
function startEnvironmentOf(request) {
  return environmentFromAddress(request.query.environment)?.environment
}

function captionOf(team, pending) {
  if (pending.kind !== KIND.change) {
    return team.name
  }

  const { target } = pending

  return `${team.name} · ${target.name} in ${environmentRegistryName(target.environment)}`
}

function whereView(h, { request, team, pending, problem }) {
  const start = pending?.start ?? startEnvironmentOf(request)
  const journey = pending ?? { kind: KIND.add, start }

  return h.view('environments/federate-where', {
    pageTitle: `${problem ? 'Error: ' : ''}${WHERE_HEADING}`,
    heading: WHERE_HEADING,
    caption: team.name,
    backLink: backLinkOf(request, team, journey, STEP.where),
    host: problem ? undefined : pending?.host,
    errorSummary: problem?.errorSummary ?? null,
    fieldErrors: problem?.fieldErrors ?? {}
  })
}

function textView(h, { request, team, pending, step, problem }) {
  const { field, heading, hint } = TEXT_STEPS[step]

  return h.view('environments/federate-text', {
    pageTitle: `${problem ? 'Error: ' : ''}${heading}`,
    heading,
    hint,
    field,
    caption: captionOf(team, pending),
    backLink: backLinkOf(request, team, pending, step),
    value: problem?.values?.[field] ?? pending[field] ?? '',
    errorSummary: problem?.errorSummary ?? null,
    fieldError: problem?.fieldErrors?.[field] ?? null
  })
}

function problemOf(request, error) {
  return {
    values: request.payload ?? {},
    errorSummary: buildErrorSummary(error),
    fieldErrors: buildFieldErrors(error)
  }
}

// A question that is for the other host (or has no journey under way) is not
// this person's to answer yet: they start, or go on, from where it runs.
function misplaced(h, team, pending, step) {
  const { host } = TEXT_STEPS[step]
  const fits = pending && (!host || pending.host === host)

  return fits ? null : redirectTo(h, federateUrl(team.slug))
}

function textStep(step) {
  const { field, schema } = TEXT_STEPS[step]

  return {
    get: {
      options: { validate: querySchema },
      async handler(request, h) {
        const context = await loadTeamContext(request, h)

        if (context.page) {
          return context.page
        }

        const pending = pendingFor(request, context.team.slug)

        return (
          misplaced(h, context.team, pending, step) ??
          textView(h, { request, ...context, pending, step })
        )
      }
    },
    post: {
      options: {
        validate: {
          ...querySchema,
          payload: schema,
          async failAction(request, h, error) {
            const context = await loadTeamContext(request, h)

            if (context.page) {
              return context.page.takeover()
            }

            const pending = pendingFor(request, context.team.slug)
            const away = misplaced(h, context.team, pending, step)

            return (
              away ??
              textView(h, {
                request,
                ...context,
                pending,
                step,
                problem: problemOf(request, error)
              }).code(statusCodes.badRequest)
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
        const away = misplaced(h, team, pendingFor(request, team.slug), step)

        if (away) {
          return away
        }

        const saved = savePending(request, team.slug, {
          [field]: request.payload[field]
        })

        return redirectTo(h, nextUrl(request, team, saved, step))
      }
    }
  }
}

function startOf(request, known) {
  return startEnvironmentOf(request) ?? known?.start
}

// The first question: where the application runs. The same answer again goes
// on with what was answered; another answer starts the questions of that host.
const where = {
  get: {
    options: { validate: querySchema },
    async handler(request, h) {
      const context = await loadTeamContext(request, h)

      if (context.page) {
        return context.page
      }

      const known = pendingFor(request, context.team.slug)
      const pending = known?.kind === KIND.add ? known : undefined

      return whereView(h, { request, ...context, pending })
    }
  },
  post: {
    options: {
      validate: {
        ...querySchema,
        payload: hostSchema,
        async failAction(request, h, error) {
          const context = await loadTeamContext(request, h)

          if (context.page) {
            return context.page.takeover()
          }

          return whereView(h, {
            request,
            ...context,
            pending: pendingFor(request, context.team.slug),
            problem: problemOf(request, error)
          })
            .code(statusCodes.badRequest)
            .takeover()
        }
      }
    },
    async handler(request, h) {
      const context = await loadTeamContext(request, h)

      if (context.page) {
        return context.page
      }

      const { team } = context
      const { host } = request.payload
      const known = pendingFor(request, team.slug)
      const same = known?.kind === KIND.add && known.host === host
      const start = startOf(request, known)
      const pending = same
        ? savePending(request, team.slug, { start })
        : startPending(request, team.slug, { kind: KIND.add, host, start })

      return redirectTo(h, nextUrl(request, team, pending, STEP.where))
    }
  }
}

/**
 * The questions of the Federate journey that take an answer of one kind:
 * where the application runs, then its CDP service, or its Azure managed
 * identity's principal ID and its name. Any member of the team can federate.
 */
export const federateQuestions = {
  where,
  service: textStep(STEP.service),
  principalId: textStep(STEP.principalId),
  name: textStep(STEP.name)
}

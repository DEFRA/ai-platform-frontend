import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  defaultTeamEnvironment,
  teamEnvironmentList
} from '#/server/common/helpers/environment-names.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  getSessionUser,
  setPendingAccess
} from '#/server/common/helpers/session.js'
import {
  MAX_MODELS_PER_REQUEST,
  teamJourneyOf
} from '#/server/routes/connect/team-journey.js'
import { loadModelChoices } from '#/server/routes/connect/team-model-choices.js'
import {
  isForbidden,
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamUrl
} from './team-view.js'

const CHECK_URL = '/connect/team/check'
const START_URL = '/connect/team/start'

const setUpSchema = Joi.object({
  modelSlugs: Joi.array()
    .items(Joi.string().pattern(/^[a-z0-9-]+$/))
    .single()
    .unique()
    .min(1)
    .max(MAX_MODELS_PER_REQUEST)
    .required()
    .messages({
      'any.required': 'Select at least one model',
      'array.min': 'Select at least one model',
      'array.max': `Select no more than ${MAX_MODELS_PER_REQUEST} models`,
      'array.unique': 'Select each model only once',
      'string.pattern.base': 'Select models from the list'
    })
})

/**
 * The environment an address names (`/teams/{slug}/test`), by its lower-case
 * name, when this instance lets teams deploy to it. Anything else, an unknown
 * name or an environment that is not available yet, is undefined.
 * @param {string} name
 * @returns {{environment: string, name: string, available: boolean} | undefined}
 */
function availableEnvironment(name) {
  return teamEnvironmentList().find(
    (item) => item.available && item.name.toLowerCase() === name
  )
}

function environmentNotFoundView(h, slug) {
  return h
    .view('error/index', {
      pageTitle: 'Page not found',
      heading: 'Page not found',
      message: 'This environment is not available yet.',
      actionHref: teamUrl({ slug }),
      actionText: 'Back to the team'
    })
    .code(statusCodes.notFound)
}

// The team as the person sees it, or null when it is not theirs to see (a
// team they do not belong to is the same answer as one that does not exist).
async function loadTeam(request, slug) {
  try {
    return await loadTeamForView(request, slug)
  } catch (error) {
    if (isNotFound(error) || isForbidden(error)) {
      return null
    }

    throw error
  }
}

/**
 * What the page offers: the models the team has ready where it starts, that
 * the target environment can deploy and the team does not already have there.
 * @returns {Promise<Array<{slug: string, displayName: string}>>}
 */
async function loadOffered(request, { slug, source, target }) {
  const choices = await loadModelChoices(request, {
    teamSlug: slug,
    environment: target,
    readyIn: source
  })

  return choices.models.filter(({ slug: model }) => !choices.held.has(model))
}

/**
 * What the person already answered for this team and environment, when they
 * come back here from the check page, so going Back and Continue keeps it.
 * @param {import('@hapi/hapi').Request} request
 * @param {{slug: string}} team
 * @param {{environment: string}} target
 * @returns {{modelSlugs: string[], purpose: string} | undefined}
 */
function savedAnswers(request, team, target) {
  const journey = teamJourneyOf(request)

  return journey?.accessType === 'team' &&
    journey.teamSlug === team.slug &&
    journey.environment === target.environment &&
    journey.modelSlugs?.length
    ? { modelSlugs: journey.modelSlugs, purpose: journey.purpose ?? '' }
    : undefined
}
// A new journey ticks every model offered; one come back to from the check
// page keeps what was ticked there (of what is still on offer).
function initialSelection(request, { team, target, offered }) {
  const saved = savedAnswers(request, team, target)
  const slugs = offered.map(({ slug }) => slug)

  return saved ? slugs.filter((slug) => saved.modelSlugs.includes(slug)) : slugs
}

function setUpView(h, { team, target, source, offered, selected, problem }) {
  const heading = `Which models do you want in ${target.name}?`

  return h.view('teams/set-up-environment', {
    pageTitle: `${problem ? 'Error: ' : ''}${heading}`,
    heading,
    teamName: team.name,
    backLink: teamUrl(team),
    targetName: target.name,
    sourceName: source.name,
    modelItems: offered.map((model) => ({
      value: model.slug,
      text: model.displayName,
      hint: { text: `Ready in ${source.name}` },
      checked: selected.includes(model.slug)
    })),
    errorSummary: problem?.errorSummary ?? null,
    fieldErrors: problem?.fieldErrors ?? {}
  })
}

// What the page needs before it can show: the environment, the team, and the
// models on offer. `page` is what to show instead when one of them is not
// there. The first available environment is where a team starts, so it has
// nothing to set up from elsewhere: it goes to the request journey.
async function loadSetUp(request, h) {
  const { slug, environment: name } = request.params
  const target = availableEnvironment(name)

  if (!target) {
    return { page: environmentNotFoundView(h, slug) }
  }

  if (target.environment === defaultTeamEnvironment()) {
    return { page: h.redirect(START_URL).code(statusCodes.seeOther) }
  }

  const loaded = await loadTeam(request, slug)

  if (!loaded) {
    return { page: teamNotFoundView(h) }
  }

  const source = teamEnvironmentList().find(
    ({ environment }) => environment === defaultTeamEnvironment()
  )
  const offered = await loadOffered(request, {
    slug: loaded.team.slug,
    source: source.environment,
    target: target.environment
  })

  return { team: loaded.team, target, source, offered }
}

/**
 * Set up an environment (screen 19): a team's models that are ready where it
 * started, offered for another environment. Continuing hands the choice to the
 * request journey at its check page. Any member of the team can do it, as any
 * member can add models.
 */
export const environmentSetUpController = {
  get: {
    async handler(request, h) {
      const result = await loadSetUp(request, h)

      if (result.page) {
        return result.page
      }

      return setUpView(h, {
        ...result,
        selected: initialSelection(request, result)
      })
    }
  },
  post: {
    options: {
      validate: {
        payload: setUpSchema,
        async failAction(request, h, error) {
          const result = await loadSetUp(request, h)

          return (
            result.page ??
            setUpView(h, {
              ...result,
              selected: [].concat(request.payload?.modelSlugs ?? []),
              problem: {
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              }
            }).code(statusCodes.badRequest)
          ).takeover()
        }
      }
    },
    async handler(request, h) {
      const result = await loadSetUp(request, h)

      if (result.page) {
        return result.page
      }

      const { team, target, offered } = result
      const { modelSlugs } = request.payload
      const onOffer = new Set(offered.map(({ slug }) => slug))

      // The form only posts what it offered; anything else is a stale page or
      // a forged request.
      if (!modelSlugs.every((slug) => onOffer.has(slug))) {
        const text = 'Select models from the list'

        return setUpView(h, {
          ...result,
          selected: modelSlugs,
          problem: {
            errorSummary: [{ text, href: '#modelSlugs' }],
            fieldErrors: { modelSlugs: { text } }
          }
        }).code(statusCodes.badRequest)
      }

      // The request journey, joined at its check page with every answer in
      // place. What the team uses it for is not asked again.
      setPendingAccess(request, {
        accessType: 'team',
        teamSlug: team.slug,
        teamName: team.name,
        modelSlugs,
        purpose: savedAnswers(request, team, target)?.purpose ?? '',
        environment: target.environment,
        requestKey: randomUUID(),
        userId: getSessionUser(request).id
      })

      return h.redirect(CHECK_URL).code(statusCodes.seeOther)
    }
  }
}

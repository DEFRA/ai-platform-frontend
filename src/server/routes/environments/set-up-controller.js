import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  defaultTeamEnvironment,
  environmentFromAddress,
  environmentPageUrl,
  teamEnvironmentList,
  teamEnvironmentsUrl
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
  teamNotFoundView
} from '#/server/routes/teams/team-view.js'
import { deployUrl } from './environment-view.js'
import { loadFederableServices } from './federation-follow-up.js'
import { setUpApplicationsUrl } from './set-up-applications.js'

const CHECK_URL = '/connect/team/check'

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

function environmentNotFoundView(h, slug) {
  return h
    .view('error/index', {
      pageTitle: 'Page not found',
      heading: 'Page not found',
      message: 'This environment is not available yet.',
      actionHref: teamEnvironmentsUrl(slug),
      actionText: 'Back to all environments'
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
 * The journey this person already has for this team and environment, when they
 * come back here from a later step, or undefined.
 */
function sameJourney(request, team, target) {
  const journey = teamJourneyOf(request)

  return journey?.accessType === 'team' &&
    journey.teamSlug === team.slug &&
    journey.environment === target.environment
    ? journey
    : undefined
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
  const journey = sameJourney(request, team, target)

  return journey?.modelSlugs?.length
    ? { modelSlugs: journey.modelSlugs, purpose: journey.purpose }
    : undefined
}

// The CDP services already answered for this team and environment, with the
// keys of their requests, of those still on offer. An answer of none is an
// answer, so it stays; no answer yet stays unanswered.
function savedServices(request, team, target, services) {
  const answered = sameJourney(request, team, target)?.federateServices

  return answered?.filter(({ service }) => services.includes(service))
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

  return h.view('environments/set-up', {
    pageTitle: `${problem ? 'Error: ' : ''}${heading}`,
    heading,
    teamName: team.name,
    backLink: environmentPageUrl(team.slug, target.environment),
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
  const { slug } = request.params
  const target = environmentFromAddress(request.params.environment)

  if (!target) {
    return { page: environmentNotFoundView(h, slug) }
  }

  if (target.environment === defaultTeamEnvironment()) {
    return {
      page: h
        .redirect(deployUrl({ slug }, target.environment))
        .code(statusCodes.seeOther)
    }
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
              selected: [request.payload?.modelSlugs ?? []].flat(),
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

      const { team, target, source, offered } = result
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

      // The CDP services the team federated in the first environment are
      // offered next (choice B), each ticked, before the answers are checked.
      const services = await loadFederableServices(request, {
        teamSlug: team.slug,
        source: source.environment,
        target: target.environment
      })

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
        userId: getSessionUser(request).id,
        federationsOffered: services.length > 0,
        // Going Back to the models from the services keeps the answer: the
        // services chosen, with their keys, so the same answers stay the
        // same request.
        federateServices: savedServices(request, team, target, services)
      })

      return h
        .redirect(
          services.length > 0
            ? setUpApplicationsUrl(team.slug, target.environment)
            : CHECK_URL
        )
        .code(statusCodes.seeOther)
    }
  }
}

import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  defaultTeamEnvironment,
  environmentFromAddress,
  environmentSetUpUrl,
  teamEnvironmentList
} from '#/server/common/helpers/environment-names.js'
import { setPendingAccess } from '#/server/common/helpers/session.js'
import { teamJourneyOf } from '#/server/routes/connect/team-journey.js'
import { loadTeamContext } from './federation-context.js'
import { SERVICE_PATTERN } from './federation-answers.js'
import { environmentNotFound } from './error-views.js'
import { loadFederableServices } from './federation-follow-up.js'

const CHECK_URL = '/connect/team/check'
const SELECT_FROM_LIST = 'Select CDP services from the list'

const servicesSchema = Joi.object({
  // Ticking none is an answer: nothing is federated with this request.
  services: Joi.array()
    .items(Joi.string().pattern(SERVICE_PATTERN))
    .single()
    .unique()
    .default([])
    .messages({
      'array.unique': 'Select each CDP service only once',
      'string.pattern.base': SELECT_FROM_LIST
    })
})

/**
 * The address of the question that follows the models of a set-up.
 * @param {string} teamSlug
 * @param {string} environment - The environment code.
 * @returns {string}
 */
export function setUpApplicationsUrl(teamSlug, environment) {
  return `${environmentSetUpUrl(teamSlug, environment)}/applications`
}

function redirectTo(h, url) {
  return h.redirect(url).code(statusCodes.seeOther)
}

// The journey this person has under way to set this environment up, with the
// models already chosen: this question follows them. Without one, the set-up
// begins again.
function journeyFor(request, team, target) {
  const journey = teamJourneyOf(request)

  return journey?.accessType === 'team' &&
    journey.teamSlug === team.slug &&
    journey.environment === target.environment &&
    journey.federationsOffered
    ? journey
    : undefined
}

function sourceEnvironment() {
  return teamEnvironmentList().find(
    ({ environment }) => environment === defaultTeamEnvironment()
  )
}

async function load(request, h) {
  const { slug } = request.params
  const target = environmentFromAddress(request.params.environment)

  if (!target) {
    return { page: environmentNotFound(h, slug) }
  }

  const context = await loadTeamContext(request, h)

  if (context.page) {
    return context
  }

  const { team } = context
  const journey = journeyFor(request, team, target)

  if (!journey) {
    return {
      page: redirectTo(h, environmentSetUpUrl(team.slug, target.environment))
    }
  }

  const source = sourceEnvironment()
  const offered = await loadFederableServices(request, {
    teamSlug: team.slug,
    source: source.environment,
    target: target.environment
  })

  return { team, target, source, journey, offered }
}

// Ticked: what the person chose before, else every service offered.
function selectedOf(journey, offered) {
  return journey.federateServices
    ? journey.federateServices
        .map(({ service }) => service)
        .filter((service) => offered.includes(service))
    : offered
}

function applicationsView(
  h,
  { team, target, source, offered, selected, problem }
) {
  const heading = `Which CDP services should be federated in ${target.name}?`

  return h.view('environments/set-up-applications', {
    pageTitle: `${problem ? 'Error: ' : ''}${heading}`,
    heading,
    teamName: team.name,
    backLink: environmentSetUpUrl(team.slug, target.environment),
    hintText: `These are the CDP services your team federated in ${source.name}. Each one is added to ${target.name} once your models are set up.`,
    items: offered.map((service) => ({
      value: service,
      text: service,
      checked: selected.includes(service)
    })),
    errorSummary: problem?.errorSummary ?? null,
    fieldErrors: problem?.fieldErrors ?? {}
  })
}

// The key of a service's request is made when it is chosen and kept while it
// stays chosen, so confirming the same answers again is the same request.
function entriesFor(journey, services) {
  const held = new Map(
    (journey.federateServices ?? []).map((entry) => [entry.service, entry.key])
  )

  return services.map((service) => ({
    service,
    key: held.get(service) ?? randomUUID()
  }))
}

/**
 * Which CDP services federated in the first environment should the next one
 * trust (choice B): asked after the models of a set-up, with every one
 * offered ticked. The confirmed ones are asked for with the request, as that
 * environment's own change. Any member can answer, as any member can set up
 * an environment.
 */
export const setUpApplicationsController = {
  get: {
    async handler(request, h) {
      const result = await load(request, h)

      if (result.page) {
        return result.page
      }

      // Nothing left to offer (another change since, or the services were
      // removed): carry on to the check, which then asks nothing of them.
      if (result.offered.length === 0) {
        setPendingAccess(request, {
          ...result.journey,
          federationsOffered: false,
          federateServices: undefined
        })

        return redirectTo(h, CHECK_URL)
      }

      return applicationsView(h, {
        ...result,
        selected: selectedOf(result.journey, result.offered)
      })
    }
  },
  post: {
    options: {
      validate: {
        payload: servicesSchema,
        async failAction(request, h, error) {
          const result = await load(request, h)
          const text = error.details[0].message

          return (
            result.page ??
            applicationsView(h, {
              ...result,
              selected: [request.payload.services].flat(),
              problem: {
                errorSummary: [{ text, href: '#services' }],
                fieldErrors: { services: { text } }
              }
            }).code(statusCodes.badRequest)
          ).takeover()
        }
      }
    },
    async handler(request, h) {
      const result = await load(request, h)

      if (result.page) {
        return result.page
      }

      const { journey, offered } = result
      const { services } = request.payload

      // The form only posts what it offered; anything else is a stale page or
      // a forged request.
      if (!services.every((service) => offered.includes(service))) {
        return applicationsView(h, {
          ...result,
          selected: services.filter((service) => offered.includes(service)),
          problem: {
            errorSummary: [{ text: SELECT_FROM_LIST, href: '#services' }],
            fieldErrors: { services: { text: SELECT_FROM_LIST } }
          }
        }).code(statusCodes.badRequest)
      }

      setPendingAccess(request, {
        ...journey,
        federateServices: entriesFor(journey, services)
      })

      return redirectTo(h, CHECK_URL)
    }
  }
}

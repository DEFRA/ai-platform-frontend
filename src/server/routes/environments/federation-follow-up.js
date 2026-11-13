import { ApiError } from '#/server/common/helpers/api-client.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { environmentRegistryName } from '#/server/common/helpers/environment-names.js'
import { HOSTS, refusalText } from './federation-answers.js'
import { postTeamFederations, readTeamEnvironment } from './environments-api.js'

// The CDP services a team federated in one environment, offered to the next
// one it sets up (choice B), and the requests that add the ones it confirms.
// Only a service's name moves: Terraform derives the new environment's issuer
// and account, and secrets, managed identities and access windows never move.
const CDP = HOSTS.cdp
// A service still being set up is offered too: the team chose it.
const OFFERED_STATUSES = ['ready', 'setting-up']
// What an environment holds already, and so cannot be added again.
const HELD_STATUSES = ['ready', 'setting-up', 'removing']

function servicesIn(detail, statuses) {
  return (detail.applications?.items ?? [])
    .filter(({ host, status }) => host === CDP && statuses.includes(status))
    .map(({ service }) => service)
}

/**
 * The CDP services federated in one environment that another does not hold,
 * in the order the first lists them. Nothing is offered when the first cannot
 * be read: setting up an environment does not wait for a convenience.
 * @param {import('@hapi/hapi').Request} request
 * @param {{teamSlug: string, source: string, target: string}} environments
 * @returns {Promise<string[]>}
 */
export async function loadFederableServices(
  request,
  { teamSlug, source, target }
) {
  try {
    const [from, to] = await Promise.all([
      readTeamEnvironment(request, teamSlug, source),
      // The new environment may have nothing to read yet (the backend says so);
      // anything else is not "empty".
      readTeamEnvironment(request, teamSlug, target).catch((error) => {
        if (error instanceof ApiError) {
          return {}
        }

        throw error
      })
    ])
    const held = new Set(servicesIn(to, HELD_STATUSES))

    return servicesIn(from, OFFERED_STATUSES).filter(
      (service) => !held.has(service)
    )
  } catch (error) {
    if (error instanceof ApiError) {
      request.logger.warn({ err: error }, 'Could not read the CDP services')

      return []
    }

    throw error
  }
}

// Why one service could not be added: the backend's per-environment code for a
// refusal, else the code of the error.
function reasonOf(error) {
  return error.environments?.[0]?.code ?? error.code
}

// A timeout, a dropped connection or a failure of the backend (the client
// reports the first two as a 502) says nothing about whether the request was
// queued: it may have been, with only the answer lost. Only a 4xx is the
// backend's own word that it was refused.
function outcomeUnknown(error) {
  return error.statusCode >= statusCodes.internalServerError
}

async function federateOne(request, { teamSlug, environment, entry }) {
  try {
    await postTeamFederations(
      request,
      teamSlug,
      { host: CDP, service: entry.service, environments: [environment] },
      entry.key
    )

    return { service: entry.service, queued: true }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error
    }

    if (outcomeUnknown(error)) {
      request.logger.warn(
        { err: error },
        'Could not confirm whether the CDP service was added'
      )

      return { service: entry.service, unknown: true }
    }

    return { service: entry.service, code: reasonOf(error) }
  }
}

function joinServices(services) {
  return services.length > 1
    ? `${services.slice(0, -1).join(', ')} and ${services.at(-1)}`
    : services[0]
}

function refusalSentence({ service, code }, environmentName) {
  if (code === 'environment-not-set-up') {
    return `${service} cannot be added until ${environmentName} is set up. Federate it from the ${environmentName} page once your models are ready.`
  }

  const reason = refusalText(code, { name: service, environmentName })

  return `${reason}.`
}

function unknownSentence(unknown, environmentName) {
  const services = unknown.map(({ service }) => service)
  const verb = services.length > 1 ? 'were' : 'was'

  return `We could not confirm whether ${joinServices(services)} ${verb} added to ${environmentName}: they may already be queued. Check Changes in progress, or select Request access again on the Check your answers page to ask again: repeating the request is safe.`
}

/**
 * The banner for the services a team confirmed with its request: that they
 * will be federated, why one could not be added yet, or that the outcome of
 * one is not known (which is not a refusal).
 * @param {Array<{service: string, queued?: boolean, unknown?: boolean, code?: string}>} outcomes
 * @param {string} environment - The environment code.
 * @returns {{type: string, heading: string, message: string} | null}
 */
export function followUpNotification(outcomes, environment) {
  const name = environmentRegistryName(environment)
  const queued = outcomes.filter(({ queued: done }) => done)
  const unknown = outcomes.filter(({ unknown: lost }) => lost)
  const refused = outcomes.filter(
    ({ queued: done, unknown: lost }) => !done && !lost
  )

  if (outcomes.length === 0) {
    return null
  }

  if (refused.length === 0 && unknown.length === 0) {
    return {
      type: 'success',
      heading: `${joinServices(queued.map(({ service }) => service))} will be federated in ${name}`,
      message:
        'This follows your models being set up. You can follow it under Changes in progress.'
    }
  }

  return {
    type: 'warning',
    heading: `We could not add every CDP service to ${name}`,
    message: [
      ...refused.map((outcome) => refusalSentence(outcome, name)),
      ...(unknown.length > 0 ? [unknownSentence(unknown, name)] : [])
    ].join(' ')
  }
}

/**
 * Asks for each confirmed CDP service to be federated in the environment just
 * requested, one request each, in order: they are changes to one team file.
 * Never fails the request already made: a service refused is said, not thrown.
 * `unresolved` is true while any outcome is not known, so the caller keeps the
 * answers and the keys of the requests: asking again with the same keys is
 * replayed by the backend, never made twice.
 * @param {import('@hapi/hapi').Request} request
 * @param {{teamSlug: string, environment: string, services: Array<{service: string, key: string}>}} params
 * @returns {Promise<{notification: ReturnType<typeof followUpNotification>, unresolved: boolean}>}
 */
export async function federateAfterRequest(
  request,
  { teamSlug, environment, services }
) {
  const outcomes = []

  for (const entry of services) {
    // Sequential: the order is the order of the changes to the file.
    outcomes.push(
      await federateOne(request, { teamSlug, environment, entry }) // NOSONAR
    )
  }

  return {
    notification: followUpNotification(outcomes, environment),
    unresolved: outcomes.some(({ unknown }) => unknown)
  }
}

import { ApiError } from '#/server/common/helpers/api-client.js'
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
      // The new environment may have nothing to read yet.
      readTeamEnvironment(request, teamSlug, target).catch(() => ({}))
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

/**
 * The banner for the services a team confirmed with its request: that they
 * will be federated, or why one could not be added yet.
 * @param {Array<{service: string, queued?: boolean, code?: string}>} outcomes
 * @param {string} environment - The environment code.
 * @returns {{type: string, heading: string, message: string} | null}
 */
export function followUpNotification(outcomes, environment) {
  const name = environmentRegistryName(environment)
  const queued = outcomes.filter(({ queued: done }) => done)
  const refused = outcomes.filter(({ queued: done }) => !done)

  if (outcomes.length === 0) {
    return null
  }

  if (refused.length === 0) {
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
    message: refused.map((outcome) => refusalSentence(outcome, name)).join(' ')
  }
}

/**
 * Asks for each confirmed CDP service to be federated in the environment just
 * requested, one request each, in order: they are changes to one team file.
 * Never fails the request already made: a service refused is said, not thrown.
 * @param {import('@hapi/hapi').Request} request
 * @param {{teamSlug: string, environment: string, services: Array<{service: string, key: string}>}} params
 * @returns {Promise<ReturnType<typeof followUpNotification>>}
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

  return followUpNotification(outcomes, environment)
}

import { reply } from '#/test-helpers/api-mock.js'
import { TEAM_PATH, INFRADEV_URL } from '#/test-helpers/environments-helpers.js'

/**
 * Fixtures for the Federate journey: the backend's federation routes
 * (`POST .../federations/check`, `POST .../federations`) answering from what
 * the page sent.
 */

export const FEDERATE_URL = `${INFRADEV_URL.replace('/infradev', '')}/federate`
export const FEDERATIONS_PATH = `${TEAM_PATH}/federations`
export const PRINCIPAL_ID = '11111111-1111-4111-8111-111111111111'

/**
 * The dry run: for each environment asked for, the code it is refused with
 * (`codes[environment]`), or null.
 * @param {Record<string, string>} codes
 */
export function dryRun(codes = {}) {
  return async (request) => {
    const body = await request.json()

    return {
      environments: body.environments.map((environment) => ({
        environment,
        code: codes[environment] ?? null
      }))
    }
  }
}

/**
 * The backend queuing one operation for each environment asked for.
 * @param {Record<string, string>} [operationIds] - By environment.
 */
export function queued(operationIds = {}) {
  return async (request) => {
    const body = await request.json()

    return reply(202, {
      federations: body.environments.map((environment) => ({
        environment,
        id: `entry-${environment}`,
        status: 'setting-up',
        operationId: operationIds[environment] ?? `op-${environment}`
      }))
    })
  }
}

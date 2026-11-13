import { ApiError } from '#/server/common/helpers/api-client.js'
import {
  federateAfterRequest,
  followUpNotification,
  loadFederableServices
} from '#/server/routes/environments/federation-follow-up.js'
import {
  postTeamFederations,
  readTeamEnvironment
} from '#/server/routes/environments/environments-api.js'

vi.mock('#/server/routes/environments/environments-api.js', () => ({
  postTeamFederations: vi.fn(),
  readTeamEnvironment: vi.fn()
}))

describe('an error that is not the backend’s', () => {
  const request = { logger: { warn: vi.fn() } }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('is not swallowed when reading the CDP services to offer, so it reaches the error page', async () => {
    const failure = new TypeError('a bug, not a refusal')

    readTeamEnvironment.mockRejectedValue(failure)

    await expect(
      loadFederableServices(request, {
        teamSlug: 'flood-risk-team',
        source: 'infradev',
        target: 'qa'
      })
    ).rejects.toBe(failure)
    expect(request.logger.warn).not.toHaveBeenCalled()
  })

  test('is not swallowed when only the target environment read fails, so it is not taken for an empty environment', async () => {
    const failure = new TypeError('a bug, not a missing environment')

    readTeamEnvironment.mockImplementation((_request, _team, environment) =>
      environment === 'qa'
        ? Promise.reject(failure)
        : Promise.resolve({
            applications: {
              items: [{ host: 'cdp', status: 'ready', service: 'flood-api' }]
            }
          })
    )

    await expect(
      loadFederableServices(request, {
        teamSlug: 'flood-risk-team',
        source: 'infradev',
        target: 'qa'
      })
    ).rejects.toBe(failure)
  })

  test('is not swallowed when adding a confirmed service, so it is not said to be refused', async () => {
    const failure = new TypeError('a bug, not a refusal')

    postTeamFederations.mockRejectedValue(failure)

    await expect(
      federateAfterRequest(request, {
        teamSlug: 'flood-risk-team',
        environment: 'qa',
        services: [{ service: 'flood-api', key: 'key-1' }]
      })
    ).rejects.toBe(failure)
  })
})

describe('#federateAfterRequest when the outcome of an add is not known', () => {
  const request = { logger: { warn: vi.fn() } }
  const params = {
    teamSlug: 'flood-risk-team',
    environment: 'qa',
    services: [{ service: 'flood-api', key: 'key-1' }]
  }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  test.each([
    ['a dropped connection or timeout', 502, 'upstream-unavailable'],
    ['a failure of the backend', 500, 'error'],
    ['a gateway timeout', 504, 'error']
  ])(
    'keeps the answers for %s, which may have been queued, and does not call it a refusal',
    async (_, statusCode, code) => {
      postTeamFederations.mockRejectedValue(
        new ApiError({ statusCode, code, message: 'lost' })
      )

      const result = await federateAfterRequest(request, params)

      expect(result.unresolved).toBe(true)
      expect(result.notification.type).toBe('warning')
      expect(result.notification.message).toContain(
        'We could not confirm whether flood-api was added to QA'
      )
      expect(result.notification.message).not.toContain('cannot')
    }
  )

  test('is resolved by a refusal, which is a definite answer', async () => {
    postTeamFederations.mockRejectedValue(
      new ApiError({
        statusCode: 409,
        code: 'federation-refused',
        message: 'Refused',
        environments: [{ environment: 'qa', code: 'federation-exists' }]
      })
    )

    const result = await federateAfterRequest(request, params)

    expect(result.unresolved).toBe(false)
    expect(result.notification.message).toContain('already has a passwordless')
  })

  test('is resolved when every add was queued', async () => {
    postTeamFederations.mockResolvedValue({})

    const result = await federateAfterRequest(request, params)

    expect(result.unresolved).toBe(false)
    expect(result.notification.type).toBe('success')
  })

  test('is resolved when nothing was confirmed', async () => {
    await expect(
      federateAfterRequest(request, { ...params, services: [] })
    ).resolves.toEqual({ notification: null, unresolved: false })
  })

  test('still asks for the services after the one whose outcome is not known, and says each', async () => {
    postTeamFederations
      .mockRejectedValueOnce(
        new ApiError({ statusCode: 502, code: 'upstream-unavailable' })
      )
      .mockResolvedValueOnce({})

    const result = await federateAfterRequest(request, {
      ...params,
      services: [
        { service: 'flood-api', key: 'key-1' },
        { service: 'flood-worker', key: 'key-2' }
      ]
    })

    expect(postTeamFederations).toHaveBeenCalledTimes(2)
    expect(result.unresolved).toBe(true)
    expect(result.notification.message).toContain('flood-api')
    expect(result.notification.message).not.toContain('flood-worker')
  })
})

describe('#loadFederableServices when the target environment has nothing to read', () => {
  const request = { logger: { warn: vi.fn() } }

  test('offers every service of the source when the backend has no record of the target', async () => {
    readTeamEnvironment.mockImplementation((_request, _team, environment) =>
      environment === 'qa'
        ? Promise.reject(
            new ApiError({
              statusCode: 404,
              code: 'environment-not-found',
              message: 'No such environment'
            })
          )
        : Promise.resolve({
            applications: {
              items: [{ host: 'cdp', status: 'ready', service: 'flood-api' }]
            }
          })
    )

    await expect(
      loadFederableServices(request, {
        teamSlug: 'flood-risk-team',
        source: 'infradev',
        target: 'qa'
      })
    ).resolves.toEqual(['flood-api'])
  })
})

describe('#followUpNotification', () => {
  test('says nothing when no service was confirmed', () => {
    expect(followUpNotification([], 'qa')).toBeNull()
  })

  test('says one service will be federated', () => {
    expect(
      followUpNotification([{ service: 'flood-api', queued: true }], 'qa')
    ).toEqual({
      type: 'success',
      heading: 'flood-api will be federated in QA',
      message:
        'This follows your models being set up. You can follow it under Changes in progress.'
    })
  })

  test.each([
    [['a', 'b'], 'a and b'],
    [['a', 'b', 'c'], 'a, b and c']
  ])('lists %j in words', (services, expected) => {
    expect(
      followUpNotification(
        services.map((service) => ({ service, queued: true })),
        'preprod'
      ).heading
    ).toBe(`${expected} will be federated in PREPROD`)
  })

  test('says each service that could not be added, with its reason, and not the ones that could', () => {
    const notification = followUpNotification(
      [
        { service: 'flood-api', queued: true },
        { service: 'flood-worker', code: 'federation-exists' },
        { service: 'flood-jobs', code: 'environment-not-set-up' }
      ],
      'qa'
    )

    expect(notification.type).toBe('warning')
    expect(notification.heading).toBe(
      'We could not add every CDP service to QA'
    )
    expect(notification.message).toBe(
      'QA: your team already has a passwordless credential for flood-worker there. flood-jobs cannot be added until QA is set up. Federate it from the QA page once your models are ready.'
    )
  })

  test('says an unknown outcome is not a refusal, and how to settle it, alongside a refusal', () => {
    const notification = followUpNotification(
      [
        { service: 'flood-api', unknown: true },
        { service: 'flood-worker', unknown: true },
        { service: 'flood-jobs', code: 'federation-exists' }
      ],
      'qa'
    )

    expect(notification.type).toBe('warning')
    expect(notification.message).toBe(
      'QA: your team already has a passwordless credential for flood-jobs there. We could not confirm whether flood-api and flood-worker were added to QA: they may already be queued. Check Changes in progress, or select Request access again on the Check your answers page to ask again: repeating the request is safe.'
    )
  })
})

import { followUpNotification } from '#/server/routes/environments/federation-follow-up.js'

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
      'QA: your team already federates flood-worker there. flood-jobs cannot be added until QA is set up. Federate it from the QA page once your models are ready.'
    )
  })
})

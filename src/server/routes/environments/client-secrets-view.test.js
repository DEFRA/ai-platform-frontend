import {
  addableSecret,
  buildAddedSecret,
  buildClientSecrets,
  clientSecretAddUrl,
  clientSecretAddedUrl,
  secretCount
} from './client-secrets-view.js'
import {
  clientSecretItem,
  clientSecretsOf
} from '#/test-helpers/environments-helpers.js'

const team = { _id: 'team-1', slug: 'flood-risk-team', name: 'Flood Risk Team' }

function build({ detail = {}, isAdmin = true } = {}) {
  return buildClientSecrets({
    team,
    environment: 'infradev',
    registryName: 'Infradev',
    isAdmin,
    detail: {
      setUp: true,
      applications: { used: 0, limit: 20 },
      clientSecrets: clientSecretsOf([clientSecretItem()]),
      ...detail
    }
  })
}

describe('#client-secrets-view', () => {
  describe('addresses', () => {
    test('are under the environment’s page', () => {
      expect(clientSecretAddUrl('flood-risk-team', 'infradev')).toBe(
        '/environments/flood-risk-team/infradev/client-secrets/add'
      )
      expect(clientSecretAddedUrl('flood-risk-team', 'infradev')).toBe(
        '/environments/flood-risk-team/infradev/client-secrets/added'
      )
    })
  })

  describe('buildClientSecrets, where they are allowed', () => {
    test('counts the places in use and says what a secret is for', () => {
      const view = build({
        detail: {
          clientSecrets: clientSecretsOf([
            clientSecretItem(),
            clientSecretItem({ id: 'cred-2', keyHint: 'c3d4' })
          ])
        }
      })

      expect(view).toMatchObject({
        state: 'allowed',
        used: 2,
        limit: 3,
        full: false
      })
      expect(view.intro).toBe(
        '2 of 3 client secrets in use. Each lasts at most three months. Use one for local development; your deployed applications should use a passwordless credential.'
      )
      expect(view.fullMessage).toBeNull()
    })

    test('lists each secret with its key hint, state and expiry', () => {
      const view = build({
        detail: {
          clientSecrets: clientSecretsOf([
            clientSecretItem(),
            clientSecretItem({
              id: 'cred-2',
              keyHint: 'c3d4',
              expiresAt: null
            }),
            clientSecretItem({
              id: 'cred-3',
              keyHint: 'e5f6',
              status: 'expired',
              expiresAt: '2026-10-01T00:00:00.000Z'
            }),
            clientSecretItem({
              id: 'cred-4',
              keyHint: 'g7h8',
              status: 'expired',
              expiresAt: null
            })
          ])
        }
      })

      expect(
        view.items.map(({ name, tag, expiryText }) => [
          name,
          tag.text,
          expiryText
        ])
      ).toEqual([
        ['Ends a1b2', 'Active', 'Expires 19 October 2027'],
        ['Ends c3d4', 'Active', 'Does not expire'],
        ['Ends e5f6', 'Expired', 'Expired 1 October 2026'],
        ['Ends g7h8', 'Expired', null]
      ])
      expect(view.items[0].tag.tagClass).toBe('govuk-tag--green')
      expect(view.items[2].tag.tagClass).toBe('govuk-tag--grey')
    })

    test('titles a named secret with its name and key hint, and an unnamed one with the hint alone', () => {
      const view = build({
        detail: {
          clientSecrets: clientSecretsOf([
            clientSecretItem({ name: 'local-dev' }),
            clientSecretItem({ id: 'cred-2', keyHint: 'c3d4', name: null }),
            clientSecretItem({ id: 'cred-3', keyHint: 'e5f6', name: undefined })
          ])
        }
      })

      expect(view.items.map(({ name }) => name)).toEqual([
        'local-dev, ends a1b2',
        'Ends c3d4',
        'Ends e5f6'
      ])
    })

    test('has no items when the backend lists none', () => {
      const view = build({
        detail: { clientSecrets: { allowed: true, used: 0, limit: 3 } }
      })

      expect(view.items).toEqual([])
    })

    test('lets an admin view, rotate and revoke a secret that is active, and no other', () => {
      const view = build({
        detail: {
          clientSecrets: clientSecretsOf([
            clientSecretItem(),
            clientSecretItem({ id: 'cred-2', status: 'expired' })
          ])
        }
      })

      expect(view.items[0].actions).toEqual([
        {
          text: 'View',
          href: '/teams/flood-risk-team/client-secrets/cred-1/view'
        },
        {
          text: 'Rotate',
          href: '/teams/flood-risk-team/client-secrets/cred-1/rotate'
        },
        {
          text: 'Revoke',
          href: '/teams/flood-risk-team/client-secrets/cred-1/revoke'
        }
      ])
      expect(view.items[0].askAnAdmin).toBe(false)
      expect(view.items[1].actions).toEqual([])
      expect(view.items[1].askAnAdmin).toBe(false)
    })

    test('tells a member to ask an admin about an active secret, with no actions', () => {
      const view = build({ isAdmin: false })

      expect(view.items[0].actions).toEqual([])
      expect(view.items[0].askAnAdmin).toBe(true)
    })

    test('offers an admin, and nobody else, the way to add one', () => {
      expect(build().addUrl).toBe(
        '/environments/flood-risk-team/infradev/client-secrets/add'
      )
      expect(build({ isAdmin: false }).addUrl).toBeNull()
    })

    test('says the limit is reached, and offers no add, when all three places are taken', () => {
      const view = build({
        detail: {
          clientSecrets: clientSecretsOf([
            clientSecretItem(),
            clientSecretItem({ id: 'cred-2' }),
            clientSecretItem({ id: 'cred-3' })
          ])
        }
      })

      expect(view.full).toBe(true)
      expect(view.addUrl).toBeNull()
      expect(view.fullMessage).toBe(
        'Infradev holds 3 client secrets, the most one environment can. Revoke one, or wait for one to expire, to add another.'
      )
    })

    test('lets an expired secret free its place', () => {
      const view = build({
        detail: {
          clientSecrets: clientSecretsOf([
            clientSecretItem(),
            clientSecretItem({ id: 'cred-2' }),
            clientSecretItem({ id: 'cred-3', status: 'expired' })
          ])
        }
      })

      expect(view.used).toBe(2)
      expect(view.addUrl).not.toBeNull()
    })
  })

  describe('buildClientSecrets, where they are not available', () => {
    test('says applications use a passwordless credential, with a link to them, and offers no add', () => {
      const view = build({
        detail: {
          clientSecrets: { allowed: false, used: 0, limit: 3, items: [] }
        }
      })

      expect(view).toMatchObject({
        state: 'not-allowed',
        message:
          'Client secrets are not available in Infradev. Applications there use a passwordless credential.',
        applicationsHref: '#applications',
        addUrl: null,
        items: []
      })
    })

    test('does not link to Applications when the page has no such section', () => {
      expect(
        build({
          detail: {
            setUp: false,
            clientSecrets: { allowed: false, used: 0, limit: 3, items: [] }
          }
        }).applicationsHref
      ).toBeNull()
      expect(
        build({
          detail: {
            applications: undefined,
            clientSecrets: { allowed: false, used: 0, limit: 3, items: [] }
          }
        }).applicationsHref
      ).toBeNull()
    })

    test('says a model must be deployed first when the environment is not set up', () => {
      const view = build({ detail: { setUp: false } })

      expect(view).toMatchObject({
        state: 'not-set-up',
        message:
          'Deploy a model in Infradev first. You can add a client secret once it is set up.',
        addUrl: null
      })
    })

    test('has no section when the backend gave no read of them', () => {
      expect(build({ detail: { clientSecrets: undefined } })).toBeNull()
    })
  })

  describe('addableSecret', () => {
    const detail = (clientSecrets, setUp = true) => ({ setUp, clientSecrets })

    test('is the backend’s code for why a secret cannot be added', () => {
      expect(addableSecret(detail({ allowed: false })).code).toBe(
        'client-secrets-not-allowed'
      )
      expect(addableSecret({ setUp: true }).code).toBe(
        'client-secrets-not-allowed'
      )
      expect(
        addableSecret(detail({ allowed: true, used: 0, limit: 3 }, false)).code
      ).toBe('environment-not-set-up')
      expect(
        addableSecret(detail({ allowed: true, used: 3, limit: 3 }))
      ).toEqual({
        code: 'credential-limit-reached',
        count: secretCount({ used: 3, limit: 3 })
      })
    })

    test('has no code, and the count, when one can be added', () => {
      expect(
        addableSecret(detail({ allowed: true, used: 2, limit: 3 }))
      ).toEqual({
        code: null,
        count: {
          used: 2,
          limit: 3,
          countText: '2 of 3 client secrets in use',
          full: false
        }
      })
    })
  })

  describe('buildAddedSecret', () => {
    const environment = { environment: 'infradev', registryName: 'Infradev' }
    const issued = {
      secret: 'the-secret-value',
      credential: {
        id: 'cred-9',
        keyHint: 'z9y8',
        expiresAt: '2027-02-14T00:00:00.000Z',
        environment: 'infradev'
      }
    }

    test('shows the secret once, when it stops working and where to go next', () => {
      expect(
        buildAddedSecret({
          team,
          environment,
          issued,
          placeholderCredential: false
        })
      ).toEqual({
        heading: 'Client secret added',
        caption: 'Flood Risk Team',
        secret: 'the-secret-value',
        placeholderCredential: false,
        environmentName: 'Infradev',
        name: null,
        keyHint: 'z9y8',
        expiresText: '14 February 2027',
        expires: true,
        guidanceHref:
          '/environments/flood-risk-team/infradev#client-secret-token',
        applicationsHref: '/environments/flood-risk-team/infradev#applications',
        returnHref: '/environments/flood-risk-team/infradev',
        returnText: 'Back to Infradev'
      })
    })

    test('carries the name the admin gave it, null when there is none', () => {
      const named = buildAddedSecret({
        team,
        environment,
        issued: {
          ...issued,
          credential: { ...issued.credential, name: 'local-dev' }
        },
        placeholderCredential: false
      })

      expect(named.name).toBe('local-dev')
    })

    test('says a secret with no expiry does not expire, and carries the placeholder flag', () => {
      const view = buildAddedSecret({
        team,
        environment,
        issued: {
          ...issued,
          credential: { ...issued.credential, expiresAt: null }
        },
        placeholderCredential: true
      })

      expect(view).toMatchObject({
        expiresText: 'Does not expire',
        expires: false,
        placeholderCredential: true
      })
    })
  })
})

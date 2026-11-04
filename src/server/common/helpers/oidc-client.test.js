import * as client from 'openid-client'

import { config } from '#/config/config.js'
import {
  API_CLIENT_ID,
  CLIENT_ID,
  CLIENT_SECRET,
  TENANT,
  blockNetwork,
  clearInterceptors,
  endNetworkBlock,
  entraMetadata,
  interceptDiscovery,
  interceptTokenEndpoint,
  interceptWebIdentity,
  stubAwsCredentials,
  tokenResponse,
  webIdentityGives,
  webIdentityRefuses,
  webIdentityToken
} from '#/test-helpers/entra-network.js'
import { getOidcConfig, resetOidcConfig } from './oidc-client.js'

// The real openid-client, the real CDP Web Identity provider and the real AWS
// client run; only what answers over the network is intercepted.
const START = Date.parse('2026-11-04T09:00:00Z')
const MINUTE = 60 * 1000
const GRANT = { authenticateClient: true }

function stubConfig(values) {
  const settings = {
    'azureAd.tenantId': TENANT,
    'azureAd.clientId': CLIENT_ID,
    'azureAd.apiClientId': API_CLIENT_ID,
    'azureAd.clientSecret': CLIENT_SECRET,
    'azureAd.authMethod': 'client-secret',
    ...values
  }

  vi.spyOn(config, 'get').mockImplementation((key) =>
    key in settings ? settings[key] : config.default(key)
  )
}

// Makes a grant the way access-token.js does, so what Entra is sent can be read.
function clientCredentials(oidcConfig) {
  return client.clientCredentialsGrant(oidcConfig, { scope: 'scope-1' })
}

describe('#getOidcConfig', () => {
  beforeAll(blockNetwork)
  afterAll(endNetworkBlock)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    resetOidcConfig()
    clearInterceptors()
  })

  describe('when not configured', () => {
    test.each(['azureAd.tenantId', 'azureAd.clientId', 'azureAd.apiClientId'])(
      'rejects with no %s, and asks nothing',
      async (key) => {
        stubConfig({ [key]: null })
        const discovery = interceptDiscovery()

        await expect(getOidcConfig()).rejects.toThrow(
          /Entra ID sign-in is not configured/
        )
        expect(discovery.scope.isDone()).toBe(false)
      }
    )

    test('tries discovery again after a failure, instead of keeping the failure', async () => {
      stubConfig({})
      const down = interceptDiscovery({ answer: [503, { error: 'down' }] })
      const up = interceptDiscovery()

      await expect(getOidcConfig()).rejects.toThrow()
      const oidcConfig = await getOidcConfig()

      expect(down.requests).toHaveLength(1)
      expect(up.requests).toHaveLength(1)
      expect(oidcConfig.serverMetadata()).toEqual(entraMetadata())
    })
  })

  describe('with a client secret (localhost)', () => {
    test('discovers Entra once and keeps the configuration', async () => {
      stubConfig({})
      const discovery = interceptDiscovery()

      const first = await getOidcConfig()
      const second = await getOidcConfig()

      expect(discovery.requests).toHaveLength(1)
      expect(second).toBe(first)
      expect(first.serverMetadata()).toEqual(entraMetadata())
      expect(first.clientMetadata().client_id).toBe(CLIENT_ID)
    })

    test('proves itself on a grant with the client secret, and not with an assertion', async () => {
      stubConfig({})
      interceptDiscovery()
      const token = interceptTokenEndpoint(tokenResponse())
      const oidcConfig = await getOidcConfig(GRANT)

      await clientCredentials(oidcConfig)

      expect(token.requests).toEqual([
        {
          grant_type: 'client_credentials',
          scope: 'scope-1',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET
        }
      ])
    })

    test('discovers from the mock issuer when configured outside production', async () => {
      stubConfig({
        'azureAd.mockIssuerUrl': 'http://localhost:3100',
        isProduction: false
      })
      const mock = interceptDiscovery({
        host: 'http://localhost:3100',
        path: '/.well-known/openid-configuration',
        answer: [200, entraMetadata('http://localhost:3100/')]
      })

      const oidcConfig = await getOidcConfig()

      expect(mock.requests).toHaveLength(1)
      expect(oidcConfig.serverMetadata().issuer).toBe('http://localhost:3100/')
    })

    test('ignores the mock issuer in production', async () => {
      stubConfig({
        'azureAd.mockIssuerUrl': 'http://localhost:3100',
        isProduction: true
      })
      const mock = interceptDiscovery({
        host: 'http://localhost:3100',
        path: '/.well-known/openid-configuration',
        answer: [200, entraMetadata('http://localhost:3100/')]
      })
      const entra = interceptDiscovery()

      const oidcConfig = await getOidcConfig()

      expect(entra.requests).toHaveLength(1)
      expect(mock.scope.isDone()).toBe(false)
      expect(oidcConfig.serverMetadata().issuer).toBe(entraMetadata().issuer)
    })
  })

  describe('federated', () => {
    const audience = 'api://AzureADTokenExchange'

    // The first grant loads the AWS client with the provider, which is slow on
    // a busy machine: load it before the tests, under the hook time limit.
    beforeAll(async () => {
      await import('@defra/hapi-auth-oidc')
    })

    beforeEach(() => {
      stubAwsCredentials()
      stubConfig({
        'azureAd.authMethod': 'federated',
        'azureAd.federatedAudience': audience
      })
    })

    function assertionExpiring(minutes, subject) {
      return webIdentityToken({ expiresAt: START + minutes * MINUTE, subject })
    }

    test('reads no client secret', async () => {
      interceptDiscovery()
      interceptWebIdentity(webIdentityGives(assertionExpiring(5)))

      await getOidcConfig(GRANT)

      expect(config.get).not.toHaveBeenCalledWith('azureAd.clientSecret')
    })

    test('asks CDP Web Identity for a token for the configured audience', async () => {
      interceptDiscovery()
      const identity = interceptWebIdentity(
        webIdentityGives(assertionExpiring(5))
      )

      await getOidcConfig(GRANT)

      expect(identity.requests).toEqual([
        expect.objectContaining({
          Action: 'GetWebIdentityToken',
          'Audience.member.1': audience
        })
      ])
    })

    test('sends the token as the client assertion on a grant, with no client secret', async () => {
      interceptDiscovery()
      const assertion = assertionExpiring(5)
      interceptWebIdentity(webIdentityGives(assertion))
      const token = interceptTokenEndpoint(tokenResponse())

      await clientCredentials(await getOidcConfig(GRANT))

      expect(token.requests).toEqual([
        {
          grant_type: 'client_credentials',
          scope: 'scope-1',
          client_id: CLIENT_ID,
          client_assertion_type:
            'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: assertion
        }
      ])
    })

    test('keeps the token while it is valid, and sends a new one when it has expired', async () => {
      interceptDiscovery()
      const first = assertionExpiring(5, 'first')
      const second = assertionExpiring(10, 'second')
      const identity = interceptWebIdentity(
        webIdentityGives(first),
        webIdentityGives(second)
      )
      const token = interceptTokenEndpoint(
        tokenResponse(),
        tokenResponse(),
        tokenResponse()
      )

      await clientCredentials(await getOidcConfig(GRANT))
      vi.setSystemTime(START + 4 * MINUTE)
      await clientCredentials(await getOidcConfig(GRANT))
      vi.setSystemTime(START + 6 * MINUTE)
      await clientCredentials(await getOidcConfig(GRANT))

      expect(token.requests.map((sent) => sent.client_assertion)).toEqual([
        first,
        first,
        second
      ])
      expect(identity.requests).toHaveLength(2)
    })

    test('does not give a configuration for a grant when Web Identity gives no token', async () => {
      interceptDiscovery()
      interceptWebIdentity(webIdentityGives(''))

      await expect(getOidcConfig(GRANT)).rejects.toThrow(
        'CDP Web Identity gave no client assertion'
      )
    })

    test('does not give a configuration for a grant when Web Identity refuses', async () => {
      interceptDiscovery()
      interceptWebIdentity(webIdentityRefuses())

      await expect(getOidcConfig(GRANT)).rejects.toThrow(
        'CDP Web Identity gave no client assertion'
      )
    })

    describe('for the sign-in and sign-out addresses, which are not grants', () => {
      test('does not ask CDP Web Identity for anything', async () => {
        interceptDiscovery()
        const identity = interceptWebIdentity(
          webIdentityGives(assertionExpiring(5))
        )

        const oidcConfig = await getOidcConfig()

        expect(oidcConfig.serverMetadata()).toEqual(entraMetadata())
        expect(identity.scope.isDone()).toBe(false)
      })

      test('still gives the configuration when Web Identity is refusing, so sign-out can end the Entra session', async () => {
        interceptDiscovery()
        interceptWebIdentity(webIdentityRefuses())

        const oidcConfig = await getOidcConfig()

        expect(oidcConfig.serverMetadata().end_session_endpoint).toBe(
          entraMetadata().end_session_endpoint
        )
        await expect(getOidcConfig(GRANT)).rejects.toThrow(
          'CDP Web Identity gave no client assertion'
        )
      })
    })
  })
})

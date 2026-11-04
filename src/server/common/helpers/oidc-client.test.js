import { config } from '#/config/config.js'
import { getOidcConfig, resetOidcConfig } from './oidc-client.js'

const getCredentials = vi.fn()
const WebIdentityTokenProvider = vi.fn(function WebIdentityTokenProvider() {
  this.getCredentials = getCredentials
})

vi.mock('openid-client', () => ({
  discovery: vi.fn().mockResolvedValue('discovered-config'),
  allowInsecureRequests: 'allow-insecure-requests-marker'
}))
vi.mock('@defra/hapi-auth-oidc', () => ({
  get WebIdentityTokenProvider() {
    return WebIdentityTokenProvider
  }
}))

const ISSUER = new URL('https://login.microsoftonline.com/tenant-123/v2.0')

function stubConfig(values) {
  const settings = {
    'azureAd.tenantId': 'tenant-123',
    'azureAd.clientId': 'client-123',
    'azureAd.apiClientId': 'api-123',
    'azureAd.clientSecret': 'secret-123',
    'azureAd.authMethod': 'client-secret',
    ...values
  }

  vi.spyOn(config, 'get').mockImplementation((key) =>
    key in settings ? settings[key] : config.default(key)
  )
}

describe('#getOidcConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetOidcConfig()
  })

  describe('when not configured', () => {
    test.each(['azureAd.tenantId', 'azureAd.clientId', 'azureAd.apiClientId'])(
      'rejects with no %s',
      async (key) => {
        stubConfig({ [key]: null })

        await expect(getOidcConfig()).rejects.toThrow(
          /Entra ID sign-in is not configured/
        )
      }
    )

    test('tries discovery again after a failure, instead of keeping the failure', async () => {
      const { discovery } = await import('openid-client')
      stubConfig({})
      discovery.mockRejectedValueOnce(new Error('Entra ID is down'))

      await expect(getOidcConfig()).rejects.toThrow('Entra ID is down')
      await expect(getOidcConfig()).resolves.toBe('discovered-config')
    })
  })

  describe('with a client secret (localhost)', () => {
    test('discovers and memoizes the configuration once configured', async () => {
      stubConfig({})
      const { discovery } = await import('openid-client')

      const first = await getOidcConfig()
      const second = await getOidcConfig()

      expect(first).toBe('discovered-config')
      expect(second).toBe('discovered-config')
      expect(discovery).toHaveBeenCalledTimes(1)
      expect(discovery).toHaveBeenCalledWith(
        ISSUER,
        'client-123',
        'secret-123',
        undefined
      )
      expect(WebIdentityTokenProvider).not.toHaveBeenCalled()
    })

    test('discovers from the mock issuer when configured outside production', async () => {
      stubConfig({
        'azureAd.mockIssuerUrl': 'http://localhost:3100',
        isProduction: false
      })
      const { discovery } = await import('openid-client')

      await getOidcConfig()

      expect(discovery).toHaveBeenCalledWith(
        new URL('http://localhost:3100'),
        'client-123',
        'secret-123',
        undefined,
        { execute: ['allow-insecure-requests-marker'] }
      )
    })

    test('ignores the mock issuer in production', async () => {
      stubConfig({
        'azureAd.mockIssuerUrl': 'http://localhost:3100',
        isProduction: true
      })
      const { discovery } = await import('openid-client')

      await getOidcConfig()

      expect(discovery).toHaveBeenCalledWith(
        ISSUER,
        'client-123',
        'secret-123',
        undefined
      )
    })
  })

  describe('federated', () => {
    beforeEach(() => {
      getCredentials.mockReset().mockResolvedValue('web-identity-token-1')
      stubConfig({
        'azureAd.authMethod': 'federated',
        'azureAd.federatedAudience': 'api://AzureADTokenExchange'
      })
    })

    async function clientAuthentication() {
      const { discovery } = await import('openid-client')
      await getOidcConfig()

      return discovery.mock.calls.at(-1)[3]
    }

    test('discovers with a client-authentication function and no secret', async () => {
      const { discovery } = await import('openid-client')

      await getOidcConfig()

      expect(discovery).toHaveBeenCalledWith(
        ISSUER,
        'client-123',
        undefined,
        expect.any(Function)
      )
      expect(config.get).not.toHaveBeenCalledWith('azureAd.clientSecret')
    })

    test('asks CDP Web Identity for a token for the configured audience', async () => {
      await getOidcConfig()

      expect(WebIdentityTokenProvider).toHaveBeenCalledTimes(1)
      expect(WebIdentityTokenProvider).toHaveBeenCalledWith({
        audience: ['api://AzureADTokenExchange']
      })
    })

    test('sends the token as the client assertion on a grant', async () => {
      const authenticate = await clientAuthentication()
      const body = new URLSearchParams()

      authenticate({}, { client_id: 'client-123' }, body, new Headers())

      expect(Object.fromEntries(body)).toEqual({
        client_id: 'client-123',
        client_assertion_type:
          'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: 'web-identity-token-1'
      })
    })

    test('uses a fresh token each time the configuration is asked for', async () => {
      const authenticate = await clientAuthentication()
      getCredentials.mockResolvedValue('web-identity-token-2')

      await getOidcConfig()
      const body = new URLSearchParams()
      authenticate({}, { client_id: 'client-123' }, body, new Headers())

      expect(body.get('client_assertion')).toBe('web-identity-token-2')
      expect(WebIdentityTokenProvider).toHaveBeenCalledTimes(1)
    })

    test('does not give a configuration when there is no token to prove itself with', async () => {
      getCredentials.mockResolvedValue(undefined)

      await expect(getOidcConfig()).rejects.toThrow(
        'CDP Web Identity gave no client assertion'
      )
    })
  })
})

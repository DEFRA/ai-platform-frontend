import { config } from '#/config/config.js'
import { getOidcConfig, resetOidcConfig } from './oidc-client.js'

vi.mock('openid-client', () => ({
  discovery: vi.fn().mockResolvedValue('discovered-config'),
  allowInsecureRequests: 'allow-insecure-requests-marker'
}))

describe('#getOidcConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetOidcConfig()
  })

  test('rejects when Entra ID is not configured', async () => {
    vi.spyOn(config, 'get').mockImplementation((key) =>
      key === 'azureAd.tenantId' || key === 'azureAd.clientId'
        ? null
        : config.default(key)
    )

    await expect(getOidcConfig()).rejects.toThrow(
      /Entra ID sign-in is not configured/
    )
  })

  test('discovers and memoizes the configuration once configured', async () => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'azureAd.tenantId') return 'tenant-123'
      if (key === 'azureAd.clientId') return 'client-123'
      if (key === 'azureAd.clientSecret') return 'secret-123'
      return config.default(key)
    })

    const { discovery } = await import('openid-client')

    const first = await getOidcConfig()
    const second = await getOidcConfig()

    expect(first).toBe('discovered-config')
    expect(second).toBe('discovered-config')
    expect(discovery).toHaveBeenCalledTimes(1)
    expect(discovery).toHaveBeenCalledWith(
      new URL('https://login.microsoftonline.com/tenant-123/v2.0'),
      'client-123',
      'secret-123'
    )
  })

  test('discovers from the mock issuer when configured outside production', async () => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'azureAd.tenantId') return 'tenant-123'
      if (key === 'azureAd.clientId') return 'client-123'
      if (key === 'azureAd.clientSecret') return 'secret-123'
      if (key === 'azureAd.mockIssuerUrl') return 'http://localhost:3100'
      if (key === 'isProduction') return false
      return config.default(key)
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
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'azureAd.tenantId') return 'tenant-123'
      if (key === 'azureAd.clientId') return 'client-123'
      if (key === 'azureAd.clientSecret') return 'secret-123'
      if (key === 'azureAd.mockIssuerUrl') return 'http://localhost:3100'
      if (key === 'isProduction') return true
      return config.default(key)
    })

    const { discovery } = await import('openid-client')

    await getOidcConfig()

    expect(discovery).toHaveBeenCalledWith(
      new URL('https://login.microsoftonline.com/tenant-123/v2.0'),
      'client-123',
      'secret-123'
    )
  })
})

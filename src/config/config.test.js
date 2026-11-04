async function loadConfig(env) {
  vi.resetModules()

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value)
  }

  return import('#/config/config.js')
}

describe('#config session lifetime', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('defaults to 30 minutes idle, 8 hours overall and a warning 2 minutes before', async () => {
    const { config } = await loadConfig({})

    expect(config.get('session.idleTimeoutMs')).toBe(30 * 60 * 1000)
    expect(config.get('session.maxAgeMs')).toBe(8 * 60 * 60 * 1000)
    expect(config.get('session.warningLeadMs')).toBe(2 * 60 * 1000)
  })

  test('reads the limits from the environment and refuses a negative one', async () => {
    const { config } = await loadConfig({ SESSION_IDLE_TIMEOUT_MS: '60000' })

    expect(config.get('session.idleTimeoutMs')).toBe(60000)

    await expect(loadConfig({ SESSION_MAX_AGE_MS: '-1' })).rejects.toThrow()
  })
})

describe('#config how the frontend authenticates to Entra', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('defaults to a client secret when run locally and to federation in production', async () => {
    expect((await loadConfig({})).config.get('azureAd.authMethod')).toBe(
      'client-secret'
    )
    expect(
      (
        await loadConfig({
          NODE_ENV: 'production',
          APP_BASE_URL: 'https://portal.example.test'
        })
      ).config.get('azureAd.authMethod')
    ).toBe('federated')
  })

  test('takes the federated audience and the API client ID from the environment', async () => {
    const { config } = await loadConfig({
      AZURE_API_CLIENT_ID: '44444444-4444-4444-8444-444444444444'
    })

    expect(config.get('azureAd.federatedAudience')).toBe(
      'api://AzureADTokenExchange'
    )
    expect(config.get('azureAd.apiClientId')).toBe(
      '44444444-4444-4444-8444-444444444444'
    )
  })

  test('allows a client secret only off production and on localhost', async () => {
    const local = await loadConfig({
      AZURE_AUTH_METHOD: 'client-secret',
      APP_BASE_URL: 'http://localhost:3000'
    })

    expect(local.config.get('azureAd.authMethod')).toBe('client-secret')
  })

  test.each([
    ['in production', { NODE_ENV: 'production' }],
    ['off localhost', { APP_BASE_URL: 'https://portal.dev.example.test' }],
    [
      'on a host that only starts with localhost',
      { APP_BASE_URL: 'http://localhost.evil.example' }
    ]
  ])('refuses a client secret %s', async (_name, env) => {
    await expect(
      loadConfig({ AZURE_AUTH_METHOD: 'client-secret', ...env })
    ).rejects.toThrow(/client-secret.*localhost/)
  })

  test('allows federation anywhere', async () => {
    const { config } = await loadConfig({
      NODE_ENV: 'production',
      AZURE_AUTH_METHOD: 'federated',
      APP_BASE_URL: 'https://portal.dev.example.test'
    })

    expect(config.get('azureAd.authMethod')).toBe('federated')
  })

  test('refuses a method it does not know', async () => {
    await expect(
      loadConfig({ AZURE_AUTH_METHOD: 'password' })
    ).rejects.toThrow()
  })

  test('no longer has an email-domain allow-list', async () => {
    const { config } = await loadConfig({})

    expect(config.has('allowedEmailDomains')).toBe(false)
  })
})

describe('#config research environment and gateway', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('defaults to Infradev, with a gateway for it and for the Sandbox', async () => {
    const { config } = await loadConfig({})

    expect(config.get('researchEnvironment')).toBe('infradev')
    expect(Object.keys(config.get('gateway.baseUrls'))).toEqual([
      'infradev',
      'sandbox'
    ])
  })

  test('reads the gateway URLs from GATEWAY_BASE_URLS as JSON', async () => {
    const { config } = await loadConfig({
      RESEARCH_ENVIRONMENT: 'sandbox',
      GATEWAY_BASE_URLS: JSON.stringify({ sandbox: 'https://gateway.test' })
    })

    expect(config.get('gateway.baseUrls')).toEqual({
      sandbox: 'https://gateway.test'
    })
  })

  test('refuses to start when the research environment has no gateway', async () => {
    await expect(
      loadConfig({
        RESEARCH_ENVIRONMENT: 'infradev',
        GATEWAY_BASE_URLS: JSON.stringify({ sandbox: 'https://gateway.test' })
      })
    ).rejects.toThrow(
      'GATEWAY_BASE_URLS has no gateway for RESEARCH_ENVIRONMENT "infradev"'
    )
  })

  test('refuses an inherited property name as the research environment', async () => {
    await expect(
      loadConfig({ RESEARCH_ENVIRONMENT: 'constructor' })
    ).rejects.toThrow(
      'GATEWAY_BASE_URLS has no gateway for RESEARCH_ENVIRONMENT "constructor"'
    )
  })
})

async function loadConfig(env) {
  vi.resetModules()

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value)
  }

  return import('#/config/config.js')
}

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
})

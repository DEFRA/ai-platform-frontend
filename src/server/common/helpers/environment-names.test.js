import { config } from '#/config/config.js'
import {
  credentialEnvironment,
  credentialEnvironmentName,
  defaultTeamEnvironment,
  environmentFromAddress,
  environmentFromName,
  environmentName,
  environmentPageUrl,
  environmentRegistryName,
  environmentSetUpUrl,
  researchEnvironment,
  teamEnvironmentList,
  teamEnvironmentsUrl
} from './environment-names.js'

describe('environment-names', () => {
  const configured = config.get('teamEnvironments')

  afterEach(() => {
    config.set('teamEnvironments', configured)
  })

  test('names the environments the platform knows (D12) and passes an unknown code through', () => {
    expect(environmentName('dev')).toBe('Development')
    expect(environmentName('infradev')).toBe('Development')
    expect(environmentName('qa')).toBe('Test')
    expect(environmentName('preprod')).toBe('Pre-production')
    expect(environmentName('prod')).toBe('Production')
    expect(environmentName('made-up')).toBe('made-up')
  })

  describe('teamEnvironmentList', () => {
    test('lists dev, qa, preprod and prod in order under their names, available when configured', () => {
      config.set('teamEnvironments', ['dev', 'qa'])

      expect(teamEnvironmentList()).toEqual([
        { environment: 'dev', name: 'Development', available: true },
        { environment: 'qa', name: 'Test', available: true },
        { environment: 'preprod', name: 'Pre-production', available: false },
        { environment: 'prod', name: 'Production', available: false }
      ])
    })

    test('keeps the order whatever order the environments are configured in', () => {
      config.set('teamEnvironments', ['prod', 'qa', 'dev'])

      expect(teamEnvironmentList().map((item) => item.environment)).toEqual([
        'dev',
        'qa',
        'preprod',
        'prod'
      ])
    })

    test('puts infradev in the dev slot, reading Development, when it is configured', () => {
      config.set('teamEnvironments', ['infradev'])

      expect(teamEnvironmentList()[0]).toEqual({
        environment: 'infradev',
        name: 'Development',
        available: true
      })
    })

    test('prefers dev when both dev and infradev are configured', () => {
      config.set('teamEnvironments', ['infradev', 'dev'])

      expect(teamEnvironmentList()[0].environment).toBe('dev')
    })

    test('shows every environment as not available yet when none is configured, and ignores codes outside the list', () => {
      config.set('teamEnvironments', ['sandbox'])

      expect(teamEnvironmentList().map((item) => item.available)).toEqual([
        false,
        false,
        false,
        false
      ])
    })
  })

  describe('defaultTeamEnvironment', () => {
    test('is the first available environment', () => {
      config.set('teamEnvironments', ['qa', 'prod'])

      expect(defaultTeamEnvironment()).toBe('qa')
    })

    test('is infradev on the test instance, where it fills the dev slot', () => {
      config.set('teamEnvironments', ['infradev', 'qa'])

      expect(defaultTeamEnvironment()).toBe('infradev')
    })

    test('is undefined when nothing is available', () => {
      config.set('teamEnvironments', [])

      expect(defaultTeamEnvironment()).toBeUndefined()
    })
  })

  describe('environment addresses', () => {
    test('the set up address is the team slug and the registry code, under the Environments section', () => {
      expect(environmentSetUpUrl('flood-risk-mapping', 'qa')).toBe(
        '/environments/flood-risk-mapping/qa/set-up'
      )
      expect(environmentSetUpUrl('flood-risk-mapping', 'infradev')).toBe(
        '/environments/flood-risk-mapping/infradev/set-up'
      )
    })

    test('the environment page and the overview are built the same way', () => {
      expect(environmentPageUrl('flood-risk-mapping', 'infradev')).toBe(
        '/environments/flood-risk-mapping/infradev'
      )
      expect(teamEnvironmentsUrl('flood-risk-mapping')).toBe(
        '/environments/flood-risk-mapping'
      )
    })

    test('keeps a slug safe in an address', () => {
      expect(environmentSetUpUrl('a/b?c', 'qa')).toBe(
        '/environments/a%2Fb%3Fc/qa/set-up'
      )
      expect(environmentPageUrl('a/b?c', 'qa')).toBe(
        '/environments/a%2Fb%3Fc/qa'
      )
      expect(teamEnvironmentsUrl('a/b?c')).toBe('/environments/a%2Fb%3Fc')
    })
  })

  describe('environmentRegistryName', () => {
    test('names Infradev as the registry does, and the others in capitals', () => {
      expect(environmentRegistryName('infradev')).toBe('Infradev')
      expect(environmentRegistryName('dev')).toBe('DEV')
      expect(environmentRegistryName('qa')).toBe('QA')
      expect(environmentRegistryName('preprod')).toBe('PREPROD')
      expect(environmentRegistryName('prod')).toBe('PROD')
    })
  })

  describe('environmentFromAddress', () => {
    test('finds an available environment by its code', () => {
      config.set('teamEnvironments', ['infradev'])

      expect(environmentFromAddress('infradev')).toEqual({
        environment: 'infradev',
        name: 'Development',
        registryName: 'Infradev',
        available: true
      })
    })

    test.each(['qa', 'prod', 'nowhere', 'Infradev', ''])(
      'is undefined for %j, which is not an available environment',
      (code) => {
        config.set('teamEnvironments', ['infradev'])

        expect(environmentFromAddress(code)).toBeUndefined()
      }
    )

    test('finds an environment by the lower case name an old address used', () => {
      config.set('teamEnvironments', ['infradev', 'qa'])

      expect(environmentFromName('development')?.environment).toBe('infradev')
      expect(environmentFromName('test')?.environment).toBe('qa')
      expect(environmentFromName('pre-production')?.environment).toBe('preprod')
      expect(environmentFromName('nowhere')).toBeUndefined()
    })
  })

  test('takes a credential to the environment it was issued in, whatever the tier', () => {
    expect(
      credentialEnvironmentName({ tier: 'team', environment: 'infradev' })
    ).toBe('Development')
    expect(
      credentialEnvironmentName({ tier: 'research', environment: 'infradev' })
    ).toBe('Development')
    expect(
      credentialEnvironmentName({ tier: 'research', environment: 'sandbox' })
    ).toBe('Sandbox')
  })

  test.each([null, undefined])(
    'takes a credential with environment %s to the Sandbox it predates environments in',
    (environment) => {
      expect(credentialEnvironment({ tier: 'research', environment })).toBe(
        'sandbox'
      )
      expect(credentialEnvironmentName({ tier: 'team', environment })).toBe(
        'Sandbox'
      )
    }
  )

  test('reads the research environment from configuration', () => {
    expect(researchEnvironment()).toBe('infradev')

    config.set('researchEnvironment', 'sandbox')

    expect(researchEnvironment()).toBe('sandbox')

    config.set('researchEnvironment', 'infradev')
  })
})

import { config } from '#/config/config.js'
import {
  credentialEnvironment,
  credentialEnvironmentName,
  defaultTeamEnvironment,
  environmentName,
  environmentSetUpUrl,
  researchEnvironment,
  teamEnvironmentList
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

  describe('environmentSetUpUrl', () => {
    test('is the team slug and the lower case environment name', () => {
      expect(environmentSetUpUrl('flood-risk-mapping', 'qa')).toBe(
        '/teams/flood-risk-mapping/test'
      )
      expect(environmentSetUpUrl('flood-risk-mapping', 'dev')).toBe(
        '/teams/flood-risk-mapping/development'
      )
      expect(environmentSetUpUrl('flood-risk-mapping', 'infradev')).toBe(
        '/teams/flood-risk-mapping/development'
      )
      expect(environmentSetUpUrl('flood-risk-mapping', 'preprod')).toBe(
        '/teams/flood-risk-mapping/pre-production'
      )
      expect(environmentSetUpUrl('flood-risk-mapping', 'prod')).toBe(
        '/teams/flood-risk-mapping/production'
      )
    })

    test('keeps a slug safe in an address', () => {
      expect(environmentSetUpUrl('a/b?c', 'qa')).toBe('/teams/a%2Fb%3Fc/test')
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

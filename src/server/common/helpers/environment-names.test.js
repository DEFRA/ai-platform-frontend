import { config } from '#/config/config.js'
import {
  credentialEnvironment,
  credentialEnvironmentName,
  environmentName,
  researchEnvironment
} from './environment-names.js'

describe('environment-names', () => {
  test('names the environments the platform knows and passes an unknown code through', () => {
    expect(environmentName('infradev')).toBe('Infradev')
    expect(environmentName('preprod')).toBe('Pre-production')
    expect(environmentName('made-up')).toBe('made-up')
  })

  test('takes a credential to the environment it was issued in, whatever the tier', () => {
    expect(
      credentialEnvironmentName({ tier: 'team', environment: 'infradev' })
    ).toBe('Infradev')
    expect(
      credentialEnvironmentName({ tier: 'research', environment: 'infradev' })
    ).toBe('Infradev')
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

import {
  credentialEnvironmentName,
  environmentName
} from './environment-names.js'

describe('environment-names', () => {
  test('names the environments the platform knows and passes an unknown code through', () => {
    expect(environmentName('infradev')).toBe('Infradev')
    expect(environmentName('preprod')).toBe('Pre-production')
    expect(environmentName('made-up')).toBe('made-up')
  })

  test('takes a team credential to its own environment and a research key to the Sandbox', () => {
    expect(
      credentialEnvironmentName({ tier: 'team', environment: 'infradev' })
    ).toBe('Infradev')
    expect(credentialEnvironmentName({ tier: 'team', environment: null })).toBe(
      'Sandbox'
    )
    expect(
      credentialEnvironmentName({ tier: 'research', environment: 'infradev' })
    ).toBe('Sandbox')
  })
})

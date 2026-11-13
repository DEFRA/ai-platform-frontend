import {
  cdpEnvironmentName,
  cdpTrustText
} from '#/server/common/helpers/cdp-environments.js'

describe('#cdpEnvironmentName', () => {
  test.each([
    ['infradev', 'dev'],
    ['sandbox', 'dev'],
    ['dev', 'dev'],
    ['qa', 'test'],
    ['preprod', 'perf-test'],
    ['prod', 'prod']
  ])('%s trusts CDP’s %s environment', (environment, expected) => {
    expect(cdpEnvironmentName(environment)).toBe(expected)
  })

  test('is undefined for an environment the mapping does not know', () => {
    expect(cdpEnvironmentName('elsewhere')).toBeUndefined()
  })
})

describe('#cdpTrustText', () => {
  test('says which CDP environment an environment trusts', () => {
    expect(cdpTrustText('qa')).toBe('CDP’s test environment')
  })

  test('says nothing for an unknown environment', () => {
    expect(cdpTrustText('elsewhere')).toBeNull()
  })
})

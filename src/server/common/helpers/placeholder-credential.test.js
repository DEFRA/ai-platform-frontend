import { isPlaceholderCredential } from '#/server/common/helpers/placeholder-credential.js'

describe('#isPlaceholderCredential', () => {
  test('is true for a team credential the mock issuer made', () => {
    expect(isPlaceholderCredential({ tier: 'team', issuerKey: 'mock' })).toBe(
      true
    )
  })

  test.each([
    ['a real team credential', { tier: 'team', issuerKey: 'azure-apim' }],
    ['a research credential', { tier: 'research', issuerKey: 'mock' }],
    ['a team credential with no issuer', { tier: 'team' }],
    ['no credential', undefined]
  ])('is false for %s', (_name, credential) => {
    expect(isPlaceholderCredential(credential)).toBe(false)
  })
})

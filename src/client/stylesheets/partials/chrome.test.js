import { compile } from 'sass-embedded'

const STYLESHEETS = 'src/client/stylesheets'

function compileChrome() {
  return compile(`${STYLESHEETS}/partials/_chrome.scss`, {
    loadPaths: [STYLESHEETS],
    quietDeps: true
  }).css
}

describe('Defra primary navigation', () => {
  test('Should make the mobile menu toggle white on the green bar when it is not focused', () => {
    const rule = compileChrome().match(
      /\.defra-primary-nav \.govuk-service-navigation__toggle:not\(:focus\)\s*\{([^}]*)\}/
    )

    expect(rule).not.toBeNull()
    expect(rule[1]).toMatch(/color:\s*#fff(fff)?\b/)
  })
})

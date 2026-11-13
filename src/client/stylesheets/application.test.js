import { compile, NodePackageImporter } from 'sass-embedded'

// The styles that the pages' layout relies on, read from the compiled
// application stylesheet (the same load paths as vite.config.js).
function compileApplication() {
  return compile('src/client/stylesheets/application.scss', {
    importers: [new NodePackageImporter()],
    loadPaths: [
      'node_modules',
      'src/client/stylesheets',
      'src/server',
      'src/server/common/components',
      'src/server/common/templates/partials'
    ],
    quietDeps: true
  }).css
}

/**
 * The declarations of every rule whose selector list is exactly `selector`
 * (outside or inside a media query), joined.
 * @param {string} css
 * @param {string} selector
 * @returns {string}
 */
function declarationsOf(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rules = css.matchAll(
    new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g')
  )

  return [...rules].map((rule) => rule[1]).join('\n')
}

describe('Application stylesheet', () => {
  let css

  beforeAll(() => {
    css = compileApplication()
  }, 60000)

  test('Should give secondary text the GOV.UK secondary colour and 1rem', () => {
    const rule = declarationsOf(css, '.app-secondary-text')

    expect(rule).toMatch(
      /color:\s*var\(--govuk-secondary-text-colour,\s*#484949\)/
    )
    expect(rule).toMatch(/font-size:\s*1rem/)
  })

  test('Should keep the Copy buttons in the link colour, whatever the column around them', () => {
    const rule = declarationsOf(css, '.app-copy-value__button')

    expect(rule).toMatch(/color:\s*var\(--govuk-link-colour/)
    expect(rule).toMatch(/margin-left:\s*auto/)
  })

  test('Should limit the height of a scroll region of a card to about 20rem, scrolling vertically only', () => {
    const rule = declarationsOf(css, '.app-section-card__scroll')

    expect(rule).toMatch(/max-height:\s*20rem/)
    expect(rule).toMatch(/overflow-y:\s*auto/)
    expect(rule).toMatch(/overflow-x:\s*hidden/)
    expect(declarationsOf(css, '.app-section-card__scroll:focus')).toMatch(
      /outline:\s*3px solid var\(--govuk-focus-colour/
    )
  })

  test('Should let an environment card’s rows use its whole width instead of GOV.UK’s 30, 50 and 20 percent columns', () => {
    const row = declarationsOf(
      css,
      '.app-environment-card__content .govuk-summary-list__row'
    )
    const spacer = declarationsOf(
      css,
      '.app-environment-card__content .govuk-summary-list__row::after'
    )

    expect(row).toMatch(/display:\s*block/)
    expect(spacer).toMatch(/display:\s*none/)

    const cells = declarationsOf(
      css,
      '.app-environment-card__content .govuk-summary-list__key,\n.app-environment-card__content .govuk-summary-list__value'
    )

    expect(cells).toMatch(/display:\s*block/)
    expect(cells).toMatch(/width:\s*100%/)
  })

  test('Should make the Available and Not available yet labels smaller than the 19px they were, on one line', () => {
    const tag = declarationsOf(
      css,
      '.app-environment-card__title-wrapper .govuk-tag'
    )

    expect(tag).toMatch(/font-size:\s*1rem/)
    expect(tag).toMatch(/white-space:\s*nowrap/)
    expect(tag).toMatch(/align-self:\s*center/)
  })
})

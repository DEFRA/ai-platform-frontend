import { renderComponent } from '#/test-helpers/component-helpers.js'

const ukModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  goodFor: 'Chat assistants, summarising documents',
  canTry: true,
  tryUrl: '/connect/shared/start?modelSlug=gpt-4o',
  teamAvailability: 'Runs in the UK or EU',
  canAddToTeam: true,
  addToTeamUrl: '/connect/team/start?modelSlug=gpt-4o'
}

const notForTeamsModel = {
  ...ukModel,
  slug: 'gpt-5-mini',
  displayName: 'GPT-5 mini',
  teamAvailability: 'Not for teams yet',
  canAddToTeam: false
}

describe('Model table component', () => {
  test('Should have the four columns of the design', () => {
    const $table = renderComponent('model-table', { models: [ukModel] })
    const headings = $table('th')
      .map((_, th) => $table(th).text().trim())
      .get()

    expect(headings).toEqual([
      'Model',
      'Good for',
      'Try on your own',
      'Add to a team'
    ])
  })

  test('Should render a row per model', () => {
    const $table = renderComponent('model-table', {
      models: [ukModel, notForTeamsModel]
    })

    expect($table('[data-testid="model-table-row"]')).toHaveLength(2)
  })

  test('Should link the name to the model page and show what it is good for', () => {
    const $table = renderComponent('model-table', { models: [ukModel] })
    const $link = $table('[data-testid="model-table-link"]')

    expect($link.attr('href')).toBe('/models/gpt-4o')
    expect($link.text().trim()).toBe('GPT-4o')
    expect($table('[data-testid="model-table-good-for"]').text().trim()).toBe(
      'Chat assistants, summarising documents'
    )
  })

  test('Should link "Try it" into the research journey with the model', () => {
    const $table = renderComponent('model-table', { models: [ukModel] })
    const $try = $table('[data-testid="model-table-try"] a')

    expect($try.attr('href')).toBe('/connect/shared/start?modelSlug=gpt-4o')
    expect($try.text()).toContain('Try it')
  })

  test('Should link "Add to a team" into the team journey with the model, with the hint "Runs in the UK or EU"', () => {
    const $table = renderComponent('model-table', { models: [ukModel] })
    const $cell = $table('[data-testid="model-table-team"]')

    expect($cell.find('a').attr('href')).toBe(
      '/connect/team/start?modelSlug=gpt-4o'
    )
    expect($cell.find('a').text()).toContain('Add to a team')
    expect($cell.find('.govuk-hint').text().trim()).toBe('Runs in the UK or EU')
  })

  test.each(['Not for teams yet', 'Not in the UK or EU yet'])(
    'Should say "%s" in plain words, with no link',
    (teamAvailability) => {
      const $table = renderComponent('model-table', {
        models: [{ ...ukModel, teamAvailability, canAddToTeam: false }]
      })
      const $cell = $table('[data-testid="model-table-team"]')

      expect($cell.text().trim()).toBe(teamAvailability)
      expect($cell.find('a')).toHaveLength(0)
    }
  )

  test('Should not offer "Try it" for a model that cannot be tried', () => {
    const $table = renderComponent('model-table', {
      models: [{ ...ukModel, canTry: false }]
    })
    const $cell = $table('[data-testid="model-table-try"]')

    expect($cell.find('a')).toHaveLength(0)
    expect($cell.text().trim()).toBe('Not available')
  })

  test('Should use no tags', () => {
    const $table = renderComponent('model-table', {
      models: [ukModel, notForTeamsModel]
    })

    expect($table('.govuk-tag')).toHaveLength(0)
  })

  test('Should show an empty state when there are no models', () => {
    const $table = renderComponent('model-table', { models: [] })

    expect($table('[data-testid="model-table-empty"]')).toHaveLength(1)
  })
})

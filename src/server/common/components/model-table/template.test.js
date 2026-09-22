import { renderComponent } from '#/test-helpers/component-helpers.js'

const eligibleModel = {
  slug: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai',
  contextWindow: '128,000 tokens',
  eligible: true
}

const ineligibleModel = {
  slug: 'claude-3',
  displayName: 'Claude 3',
  provider: 'anthropic',
  contextWindow: '200,000 tokens',
  eligible: false,
  statusReason: 'Not approved'
}

describe('Model table component', () => {
  test('Should render a row per model', () => {
    const $table = renderComponent('model-table', {
      models: [eligibleModel, ineligibleModel]
    })

    expect($table('[data-testid="model-table-row"]')).toHaveLength(2)
  })

  test('Should link to the model detail page for an eligible model', () => {
    const $table = renderComponent('model-table', { models: [eligibleModel] })
    const $link = $table('[data-testid="model-table-link"]')

    expect($link.attr('href')).toBe('/models/gpt-4o')
    expect($link.text().trim()).toBe('GPT-4o')
  })

  test('Should grey out and mark an ineligible model as aria-disabled, with its reason', () => {
    const $table = renderComponent('model-table', {
      models: [ineligibleModel]
    })
    const $row = $table('[data-testid="model-table-row"]')

    expect($row.attr('aria-disabled')).toBe('true')
    expect($table('[data-testid="model-table-name"]').text().trim()).toBe(
      'Claude 3'
    )
    expect($table('[data-testid="model-table-link"]')).toHaveLength(0)
    expect($table.text()).toEqual(expect.stringContaining('Not approved'))
  })

  test('Should show an empty state when there are no models', () => {
    const $table = renderComponent('model-table', { models: [] })

    expect($table('[data-testid="model-table-empty"]')).toHaveLength(1)
  })
})

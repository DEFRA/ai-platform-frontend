import { renderComponent } from '#/test-helpers/component-helpers.js'

describe('Code examples component', () => {
  let $codeExamples

  beforeEach(() => {
    $codeExamples = renderComponent('code-examples', {
      endpoint: 'https://mock-gateway.ai-platform.defra.gov.uk/openai/gpt-4o',
      secretPlaceholder: '<YOUR_SUBSCRIPTION_KEY>'
    })
  })

  test('Should render the code examples container', () => {
    expect($codeExamples('[data-testid="code-examples"]')).toHaveLength(1)
  })

  test('Should include a curl example with the endpoint and a placeholder key', () => {
    const text = $codeExamples('[data-testid="code-examples-curl"]').text()

    expect(text).toEqual(
      expect.stringContaining(
        'https://mock-gateway.ai-platform.defra.gov.uk/openai/gpt-4o'
      )
    )
    expect(text).toEqual(expect.stringContaining('<YOUR_SUBSCRIPTION_KEY>'))
  })

  test('Should include Python and JavaScript examples', () => {
    expect($codeExamples('[data-testid="code-examples-python"]')).toHaveLength(
      1
    )
    expect(
      $codeExamples('[data-testid="code-examples-javascript"]')
    ).toHaveLength(1)
  })

  test('Should escape untrusted values rather than injecting raw HTML', () => {
    const $escaped = renderComponent('code-examples', {
      endpoint: '<script>alert(1)</script>',
      secretPlaceholder: 'key'
    })

    expect($escaped('script')).toHaveLength(0)
    expect($escaped('[data-testid="code-examples-curl"]').text()).toEqual(
      expect.stringContaining('<script>alert(1)</script>')
    )
  })

  test('Should use a custom request body when given one (e.g. the responses apiProfile)', () => {
    const $custom = renderComponent('code-examples', {
      endpoint:
        'https://deploytestdefra.azure-api.net/research/openai/responses',
      secretPlaceholder: '<YOUR_SUBSCRIPTION_KEY>',
      requestBody: { model: 'gpt-5-mini', input: 'Hello' }
    })

    const text = $custom('[data-testid="code-examples-curl"]').text()
    expect(text).toEqual(expect.stringContaining('"model":"gpt-5-mini"'))
    expect(text).not.toEqual(expect.stringContaining('"messages"'))
  })
})

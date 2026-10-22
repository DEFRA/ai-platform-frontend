import { formatLabel } from './format-label.js'

describe('#formatLabel', () => {
  test('Maps a known raw value to its display label', () => {
    expect(formatLabel('openai')).toBe('OpenAI')
    expect(formatLabel('anthropic')).toBe('Anthropic')
    expect(formatLabel('meta')).toBe('Meta')
    expect(formatLabel('uksouth')).toBe('UK South')
    expect(formatLabel('ukwest')).toBe('UK West')
  })

  test('Returns an unknown value unchanged', () => {
    expect(formatLabel('some-new-status')).toBe('some-new-status')
  })

  test('Returns null/undefined unchanged', () => {
    expect(formatLabel(null)).toBe(null)
    expect(formatLabel(undefined)).toBe(undefined)
  })
})

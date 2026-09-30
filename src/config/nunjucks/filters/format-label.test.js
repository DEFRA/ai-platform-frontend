import { formatLabel, formatLabelList } from './format-label.js'

describe('#formatLabel', () => {
  test('Maps a known raw value to its display label', () => {
    expect(formatLabel('openai')).toBe('OpenAI')
    expect(formatLabel('pending')).toBe('Setting up')
    expect(formatLabel('not-approved')).toBe('Not approved')
    expect(formatLabel('uksouth')).toBe('UK South')
  })

  test('Returns an unknown value unchanged', () => {
    expect(formatLabel('some-new-status')).toBe('some-new-status')
  })

  test('Returns null/undefined unchanged', () => {
    expect(formatLabel(null)).toBe(null)
    expect(formatLabel(undefined)).toBe(undefined)
  })
})

describe('#formatLabelList', () => {
  test('Maps and joins a list of raw values', () => {
    expect(formatLabelList(['research', 'team'])).toBe('Research, Team')
  })

  test('Returns an empty string for an empty or missing list', () => {
    expect(formatLabelList([])).toBe('')
    expect(formatLabelList(undefined)).toBe('')
  })
})

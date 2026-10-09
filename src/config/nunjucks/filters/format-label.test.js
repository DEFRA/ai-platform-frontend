import { formatLabel, formatLabelList, formatDataZone } from './format-label.js'

describe('#formatDataZone', () => {
  test('Maps a data-zone code to its own label, not a region label', () => {
    expect(formatDataZone('uk')).toBe('UK')
    expect(formatDataZone('eu')).toBe('EU')
  })

  test('Returns an unknown or missing value unchanged', () => {
    expect(formatDataZone('us')).toBe('us')
    expect(formatDataZone(undefined)).toBe(undefined)
  })
})

describe('#formatLabel', () => {
  test('Maps a known raw value to its display label', () => {
    expect(formatLabel('openai')).toBe('OpenAI')
    expect(formatLabel('meta')).toBe('Meta')
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

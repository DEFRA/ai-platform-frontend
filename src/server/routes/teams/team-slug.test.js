import { deriveTeamSlug } from './team-slug.js'

describe('#deriveTeamSlug', () => {
  test.each([
    ['Flood Risk Team', 'flood-risk-team'],
    ['  Café  Données!  ', 'cafe-donnees'],
    ['2024 Data Team', 'data-team'],
    [
      'A very long team name that goes past the limit',
      'a-very-long-team-name-th'
    ],
    ['abcdefghijklmnopqrstuvw xyz', 'abcdefghijklmnopqrstuvw'],
    ['New', 'new']
  ])('%s becomes %s', (name, slug) => {
    expect(deriveTeamSlug(name)).toBe(slug)
  })

  test.each(['12', '!!!', 'ab', ''])(
    'falls back to team when %j leaves too little',
    (name) => {
      expect(deriveTeamSlug(name)).toBe('team')
    }
  )

  test('copes with no name', () => {
    expect(deriveTeamSlug(undefined)).toBe('team')
  })
})

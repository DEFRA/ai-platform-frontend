const MIN_LENGTH = 3
const MAX_LENGTH = 24
const FALLBACK_SLUG = 'team'

function trimToPattern(candidate) {
  let trimmed = candidate.slice(0, MAX_LENGTH)

  while (trimmed.endsWith('-')) {
    trimmed = trimmed.slice(0, -1)
  }

  return trimmed
}

/**
 * The team ID a team name will make, as the backend derives it
 * (`src/common/helpers/team-slug.js` there): lower case, accents folded,
 * anything else hyphenated, starting at the first letter. It is shown before
 * the team exists, so it is the backend's first choice: the backend adds a
 * number when another team already has it.
 * @param {string} name
 * @returns {string}
 */
export function deriveTeamSlug(name) {
  const folded = (name ?? '')
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const candidate = trimToPattern(
    folded.replaceAll(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '')
  )

  return candidate.length >= MIN_LENGTH ? candidate : FALLBACK_SLUG
}

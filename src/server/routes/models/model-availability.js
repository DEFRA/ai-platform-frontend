// What a person can do with a model, from the catalogue entry alone. The
// backend applies the same rules (D4) when it lists and refuses team models.

const RESEARCH_TIER = 'research'
const TEAM_TIER = 'team'
const UK_REGION_PREFIX = 'uk'
const CAPACITY_DUPLICATE_SUFFIX = '-2'

export const TEAM_AVAILABILITY = {
  inUk: 'Runs in the UK',
  notInUk: 'Not in the UK yet',
  notForTeams: 'Not for teams yet'
}

const NOT_APPROVED_REASON = 'Not approved yet'

/**
 * Why a model cannot be had, from whatever the catalogue sync carries.
 * @param {{lifecycle?: {status?: string}, eligibilityReason?: string}} model
 * @returns {string}
 */
export function unavailableReason(model) {
  if (model.lifecycle?.status === 'retired') {
    return 'Retired'
  }

  return model.eligibilityReason || NOT_APPROVED_REASON
}

/**
 * Whether the catalogue has approved the model for use at all. A model that
 * does not say is taken to be eligible.
 * @param {{eligible?: boolean}} model
 * @returns {boolean}
 */
export function isEligible(model) {
  return model.eligible !== false
}

function isInUk(regions) {
  return (
    Array.isArray(regions) &&
    regions.length > 0 &&
    regions.every((region) => region.toLowerCase().startsWith(UK_REGION_PREFIX))
  )
}

/**
 * Whether a person can try the model on their own: it is eligible and offered
 * to the research tier.
 * @param {{eligible?: boolean, tiers?: string[]}} model
 * @returns {boolean}
 */
export function canTry(model) {
  return isEligible(model) && Boolean(model.tiers?.includes(RESEARCH_TIER))
}

/**
 * What a team is told about a model. A SKU with no regions of its own takes
 * the model's.
 * - "Runs in the UK": a SKU offered to the team tier, every region in the UK.
 * - "Not in the UK yet": team SKUs, but only outside the UK.
 * - "Not for teams yet": no team SKU.
 * @param {{skus?: Array<{tiers?: string[], regions?: string[]}>, regions?: string[]}} model
 * @returns {string}
 */
export function teamAvailability(model) {
  const teamSkus = (model.skus ?? []).filter((sku) =>
    sku.tiers?.includes(TEAM_TIER)
  )

  if (teamSkus.length === 0) {
    return TEAM_AVAILABILITY.notForTeams
  }

  return teamSkus.some((sku) => isInUk(sku.regions ?? model.regions))
    ? TEAM_AVAILABILITY.inUk
    : TEAM_AVAILABILITY.notInUk
}

/**
 * The first UK region a team deployment of the model would run in, as it is
 * written in the catalogue, or undefined when it does not run in the UK. A SKU
 * with no regions of its own takes the model's.
 * @param {{skus?: Array<{tiers?: string[], regions?: string[]}>, regions?: string[]}} model
 * @returns {string | undefined}
 */
export function teamUkRegion(model) {
  for (const sku of model.skus ?? []) {
    const regions = sku.regions ?? model.regions

    if (sku.tiers?.includes(TEAM_TIER) && isInUk(regions)) {
      return regions[0]
    }
  }

  return undefined
}

/**
 * Whether a model is a capacity duplicate of another (its slug ends `-2`) and
 * so is never listed.
 * @param {{slug: string}} model
 * @returns {boolean}
 */
export function isCapacityDuplicate(model) {
  return model.slug?.endsWith(CAPACITY_DUPLICATE_SUFFIX) ?? false
}

/**
 * Splits a catalogue list for the Models page: capacity duplicates are
 * dropped, eligible models say whether they can be tried and what teams are
 * told, and ineligible ones (for example embeddings) go under "Not available
 * yet" with their `eligibilityReason`.
 * @param {object[]} models
 * @returns {{available: object[], notAvailable: object[]}}
 */
export function groupModels(models) {
  const listed = models.filter((model) => !isCapacityDuplicate(model))

  return {
    available: listed.filter(isEligible).map((model) => ({
      ...model,
      canTry: canTry(model),
      teamAvailability: teamAvailability(model)
    })),
    notAvailable: listed
      .filter((model) => !isEligible(model))
      .map((model) => ({
        ...model,
        reason: unavailableReason(model)
      }))
  }
}

export const SHOW_OPTIONS = {
  all: 'All models',
  team: 'Models you can add to a team',
  research: 'Models you can try on your own'
}

/**
 * Narrows the models that can be had to the ones a "Show" choice names:
 * "team" keeps those that run in the UK, "research" those that can be tried.
 * @param {Array<{canTry: boolean, teamAvailability: string}>} models
 * @param {'all' | 'team' | 'research'} show
 * @returns {object[]}
 */
export function filterByShow(models, show) {
  if (show === 'team') {
    return models.filter(
      (model) => model.teamAvailability === TEAM_AVAILABILITY.inUk
    )
  }

  return show === 'research' ? models.filter((model) => model.canTry) : models
}

// Use cases are kept as sentences ("Chat assistants"); mid-sentence they start
// in lower case, unless they open with an acronym ("OCR").
function lowerFirst(text) {
  return /^[A-Z]{2,}/.test(text)
    ? text
    : text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * Use cases as one phrase: the first as written, the rest in lower case.
 * "Chat assistants, summarising documents, reading images".
 * @param {string[] | undefined} useCases
 * @returns {string}
 */
export function useCasesList(useCases) {
  const [first, ...rest] = useCases ?? []

  return first === undefined ? '' : [first, ...rest.map(lowerFirst)].join(', ')
}

/**
 * Use cases as part of a sentence: lower case, the last joined with "and".
 * "chat assistants, summarising documents and reading images".
 * @param {string[] | undefined} useCases
 * @returns {string}
 */
export function useCasesSentence(useCases) {
  const phrases = (useCases ?? []).map(lowerFirst)

  if (phrases.length < 2) {
    return phrases.join('')
  }

  return `${phrases.slice(0, -1).join(', ')} and ${phrases.at(-1)}`
}

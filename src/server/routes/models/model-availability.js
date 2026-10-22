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

function isEligible(model) {
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
        reason: model.eligibilityReason || NOT_APPROVED_REASON
      }))
  }
}

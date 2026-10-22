// What a person can do with a model. Whether they can try it on their own is
// the backend's `researchAvailable`; for teams the catalogue entry says (the
// backend applies the same rules (D4) when it lists and refuses models: UK or
// EU regions only, and no SKU whose name starts with the prefix of a
// worldwide deployment).

const TEAM_TIER = 'team'
const ALLOWED_REGIONS = [
  'uksouth',
  'ukwest',
  'swedencentral',
  'northeurope',
  'westeurope'
]
const WORLDWIDE_SKU_PREFIX = 'global'
const CAPACITY_DUPLICATE_SUFFIX = '-2'

export const TEAM_AVAILABILITY = {
  inRegions: 'Runs in the UK or EU',
  notInRegions: 'Not in the UK or EU yet',
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

function inAllowedRegions(regions) {
  return (
    Array.isArray(regions) &&
    regions.length > 0 &&
    regions.every((region) =>
      ALLOWED_REGIONS.includes(String(region).toLowerCase())
    )
  )
}

function isWorldwideSku(sku) {
  return String(sku.name ?? '')
    .toLowerCase()
    .startsWith(WORLDWIDE_SKU_PREFIX)
}

// The first SKU the tier can use: it lists the tier, is not a worldwide
// deployment, and every region it is offered in (its own, else the model's) is
// in the UK or EU.
function usableSkuOf(model, tier) {
  return (model.skus ?? []).find(
    (sku) =>
      sku.tiers?.includes(tier) &&
      !isWorldwideSku(sku) &&
      inAllowedRegions(sku.regions ?? model.regions)
  )
}

/**
 * Whether a person can try the model on their own. The backend decides: it
 * sets `researchAvailable` only for a model the catalogue offers to research
 * (UK or EU, not worldwide) that research has actually deployed.
 * @param {{eligible?: boolean, researchAvailable?: boolean}} model
 * @returns {boolean}
 */
export function canTry(model) {
  return isEligible(model) && model.researchAvailable === true
}

/**
 * What a team is told about a model. A SKU with no regions of its own takes
 * the model's.
 * - "Runs in the UK or EU": a SKU offered to the team tier that is not a
 *   worldwide deployment and runs only in the UK or EU (UK South, UK West,
 *   Sweden Central, North Europe, West Europe).
 * - "Not in the UK or EU yet": team SKUs, but none that qualify.
 * - "Not for teams yet": no team SKU.
 * @param {{skus?: Array<{name?: string, tiers?: string[], regions?: string[]}>, regions?: string[]}} model
 * @returns {string}
 */
export function teamAvailability(model) {
  const hasTeamSku = (model.skus ?? []).some((sku) =>
    sku.tiers?.includes(TEAM_TIER)
  )

  if (!hasTeamSku) {
    return TEAM_AVAILABILITY.notForTeams
  }

  return usableSkuOf(model, TEAM_TIER)
    ? TEAM_AVAILABILITY.inRegions
    : TEAM_AVAILABILITY.notInRegions
}

/**
 * The first region a team deployment of the model would run in, as it is
 * written in the catalogue, or undefined when no team SKU qualifies. A SKU
 * with no regions of its own takes the model's.
 * @param {{skus?: Array<{name?: string, tiers?: string[], regions?: string[]}>, regions?: string[]}} model
 * @returns {string | undefined}
 */
export function teamRegion(model) {
  const sku = usableSkuOf(model, TEAM_TIER)

  return sku ? (sku.regions ?? model.regions)[0] : undefined
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
 * "team" keeps those that run in the UK or EU, "research" those that can be tried.
 * @param {Array<{canTry: boolean, teamAvailability: string}>} models
 * @param {'all' | 'team' | 'research'} show
 * @returns {object[]}
 */
export function filterByShow(models, show) {
  if (show === 'team') {
    return models.filter(
      (model) => model.teamAvailability === TEAM_AVAILABILITY.inRegions
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

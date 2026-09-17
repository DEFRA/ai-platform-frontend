/**
 * Converts a Joi ValidationError into the GOV.UK error summary + per-field error shapes.
 */
export function buildErrorSummary(error) {
  return error.details.map((detail) => ({
    text: detail.message,
    href: `#${detail.path.join('-')}`
  }))
}

export function buildFieldErrors(error) {
  const fieldErrors = {}

  for (const detail of error.details) {
    const key = detail.path.join('-')
    if (!fieldErrors[key]) {
      fieldErrors[key] = { text: detail.message }
    }
  }

  return fieldErrors
}

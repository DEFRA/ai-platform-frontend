import Joi from 'joi'

const MAX_DESCRIPTION_LENGTH = 500

/** A service code: three letters or numbers, in any case. */
export const serviceCodeField = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9]{3}$/)
  .required()
  .messages({
    'string.pattern.base':
      'Service code must be 3 letters or numbers, for example FRM',
    'string.empty': 'Enter your service code',
    'any.required': 'Enter your service code'
  })

/** What the team does: optional, and empty clears it. */
export const descriptionField = Joi.string()
  .trim()
  .max(MAX_DESCRIPTION_LENGTH)
  .allow('')
  .default('')
  .messages({
    'string.max': `What the team does must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`
  })

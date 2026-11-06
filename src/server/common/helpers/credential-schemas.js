import Joi from 'joi'

export const revokeConfirmSchema = Joi.object({
  confirmRevoke: Joi.string().valid('yes', 'no').required().messages({
    'any.required': 'Select yes if you want to revoke this credential',
    'any.only': 'Select yes if you want to revoke this credential'
  })
})

const MAX_REASON_LENGTH = 500

export const revealSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .min(1)
    .max(MAX_REASON_LENGTH)
    .required()
    .messages({
      'string.empty': 'Enter why you need to see this',
      'any.required': 'Enter why you need to see this'
    })
})

import Joi from 'joi'

export const revokeConfirmSchema = Joi.object({
  confirmRevoke: Joi.string().valid('yes', 'no').required().messages({
    'any.required': 'Select yes if you want to revoke this credential',
    'any.only': 'Select yes if you want to revoke this credential'
  })
})

export const revealSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(500).required().messages({
    'string.empty': 'Enter why you need to see this',
    'any.required': 'Enter why you need to see this'
  })
})

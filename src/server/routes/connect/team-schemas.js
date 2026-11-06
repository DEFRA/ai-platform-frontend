import Joi from 'joi'

import { MAX_MODELS_PER_REQUEST } from './team-journey.js'

const MAX_PURPOSE_LENGTH = 500

export const selectTeamSchema = Joi.object({
  team: Joi.string()
    .pattern(/^([a-z0-9-]+|\+create)$/)
    .required()
    .messages({
      'any.required': 'Select a team',
      'string.empty': 'Select a team',
      'string.pattern.base': 'Select a team from the list'
    })
})

// One ticked box posts a string, several post a list; both become a list.
export const selectModelsSchema = Joi.object({
  modelSlugs: Joi.array()
    .items(Joi.string().pattern(/^[a-z0-9-]+$/))
    .single()
    .unique()
    .min(1)
    .max(MAX_MODELS_PER_REQUEST)
    .required()
    .messages({
      'any.required': 'Select at least one model',
      'array.min': 'Select at least one model',
      'array.max': `Select no more than ${MAX_MODELS_PER_REQUEST} models`,
      'array.unique': 'Select each model only once',
      'string.pattern.base': 'Select models from the list'
    })
})

export const detailsSchema = Joi.object({
  purpose: Joi.string()
    .trim()
    .max(MAX_PURPOSE_LENGTH)
    .allow('')
    .optional()
    .messages({
      'string.max': `Purpose must be ${MAX_PURPOSE_LENGTH} characters or fewer`
    })
})

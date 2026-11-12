import Joi from 'joi'

// The answers of the Federate journey, one schema for each question, checked
// with the same rules as the backend (and `validate` on the team file), so a
// name CDP would not accept is refused where it is typed, in words. The backend
// still checks every one.
const MAX_SERVICE_LENGTH = 32
const MAX_NAME_LENGTH = 63
const MAX_ENVIRONMENTS = 5
export const SERVICE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const ENVIRONMENT_PATTERN = /^[a-z0-9-]+$/

export const HOSTS = { cdp: 'cdp', azure: 'azure' }

const SELECT_HOST = 'Select where your application runs'
const SERVICE_PATTERN_TEXT =
  'The CDP service name must use only lower-case letters, numbers and single hyphens'
const NAME_TEXT =
  'The name must use only lower-case letters, numbers and hyphens, start with a letter or number, and be 63 characters or fewer'

export const hostSchema = Joi.object({
  host: Joi.string().valid(HOSTS.cdp, HOSTS.azure).required().messages({
    'any.required': SELECT_HOST,
    'any.only': SELECT_HOST,
    'string.empty': SELECT_HOST
  })
})

export const serviceSchema = Joi.object({
  service: Joi.string()
    .trim()
    .max(MAX_SERVICE_LENGTH)
    .pattern(SERVICE_PATTERN)
    .required()
    .messages({
      'any.required': 'Enter your CDP service name',
      'string.empty': 'Enter your CDP service name',
      'string.max': `The CDP service name must be ${MAX_SERVICE_LENGTH} characters or fewer`,
      'string.pattern.base': SERVICE_PATTERN_TEXT
    })
})

export const principalIdSchema = Joi.object({
  principalId: Joi.string().trim().guid().required().messages({
    'any.required': 'Enter the managed identity’s principal ID',
    'string.empty': 'Enter the managed identity’s principal ID',
    'string.guid':
      'The principal ID must be a GUID, like 00000000-0000-0000-0000-000000000000'
  })
})

export const nameSchema = Joi.object({
  name: Joi.string()
    .trim()
    .max(MAX_NAME_LENGTH)
    .pattern(NAME_PATTERN)
    .required()
    .messages({
      'any.required': 'Enter a name for your application',
      'string.empty': 'Enter a name for your application',
      'string.max': NAME_TEXT,
      'string.pattern.base': NAME_TEXT
    })
})

export const environmentsSchema = Joi.object({
  environments: Joi.array()
    .items(Joi.string().pattern(ENVIRONMENT_PATTERN))
    .single()
    .unique()
    .min(1)
    .max(MAX_ENVIRONMENTS)
    .required()
    .messages({
      'any.required': 'Select at least one environment',
      'array.min': 'Select at least one environment',
      'array.max': `Select no more than ${MAX_ENVIRONMENTS} environments`,
      'array.unique': 'Select each environment only once',
      'string.pattern.base': 'Select environments from the list'
    })
})

// The check page posts back the key of the answers it showed: text, which may
// be empty or wrong (that is a stale confirmation, refused after the compare).
export const confirmSchema = Joi.object({
  key: Joi.string().allow('').default('')
})

/**
 * What the backend is asked to federate: a CDP service by its name alone, an
 * Azure application by its managed identity's principal ID and its own name,
 * in each environment chosen.
 * @param {{host: string, service?: string, principalId?: string, name?: string}} answers
 * @param {string[]} environments
 * @returns {object}
 */
export function applicationBody(answers, environments) {
  return answers.host === HOSTS.cdp
    ? { host: HOSTS.cdp, service: answers.service, environments }
    : {
        host: HOSTS.azure,
        principalId: answers.principalId,
        name: answers.name,
        environments
      }
}

const REFUSALS = {
  'federation-exists': ({ name, environmentName }) =>
    `${environmentName}: your team already federates ${name} there`,
  'federation-trusted-elsewhere': ({ name, environmentName }) =>
    `${environmentName}: another team already uses ${name} there`,
  'federation-limit-reached': ({ environmentName }) =>
    `${environmentName} already holds 20 applications`,
  'environment-not-set-up': ({ environmentName }) =>
    `${environmentName} is not set up yet. Deploy a model there first`,
  'environment-not-available': ({ environmentName }) =>
    `${environmentName} is not available yet`
}

/**
 * Why an environment refuses an application, in words that name the
 * environment and never another team.
 * @param {string} code - The backend's refusal code.
 * @param {{name: string, environmentName: string}} context
 * @returns {string}
 */
export function refusalText(code, context) {
  return (
    REFUSALS[code]?.(context) ??
    `${context.environmentName}: ${context.name} cannot be federated there`
  )
}

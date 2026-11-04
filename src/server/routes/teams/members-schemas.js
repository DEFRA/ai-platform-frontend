import Joi from 'joi'

import { MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from './team-people.js'

// What the member pages accept in a form, and what they say when it is not
// right.

export const selectPerson = 'Select a person'

const enterSearch = 'Enter a name or email address to search for'

const roleField = Joi.string().valid('admin', 'user').messages({
  'any.only': 'Select a role',
  'any.required': 'Select a role'
})

export const memberRoleSchema = Joi.object({ role: roleField.required() })

/**
 * @param {unknown} value
 * @returns {boolean} Whether the value is an id, as a person's `oid` is.
 */
export function isGuid(value) {
  return !Joi.string().guid().validate(value).error
}

// Text from the form that is shown again, never searched for as it is.
function typedText() {
  return Joi.string().allow('').messages({ 'string.base': enterSearch })
}

function searchField() {
  return Joi.string()
    .trim()
    .max(MAX_SEARCH_LENGTH)
    .messages({
      'string.base': enterSearch,
      'string.empty': enterSearch,
      'any.required': enterSearch,
      'string.min': `Enter at least ${MIN_SEARCH_LENGTH} characters of their name or email address`,
      'string.max': `Name or email address must be ${MAX_SEARCH_LENGTH} characters or fewer`
    })
}

// One form, two buttons: `search` finds people and never adds anyone (it is
// also what a missing action means), `add` adds the person chosen, with a
// role that has to be chosen. With script, the field holds the label of the
// person chosen ("Name - email") and `query` what was typed to find them, so
// on `add` neither is checked: the person is the `oid`, not the text.
// `idempotencyKey` is the key the form was issued for this add; one that is
// not a key is no key (the page then makes one), never an error to show.
export const addMemberSchema = Joi.object({
  idempotencyKey: Joi.string().guid().failover(''),
  action: Joi.string().valid('search', 'add').default('search'),
  search: Joi.when('action', {
    is: 'add',
    then: typedText().default(''),
    otherwise: searchField().min(MIN_SEARCH_LENGTH).required()
  }),
  query: Joi.when('action', {
    is: 'add',
    then: typedText(),
    otherwise: Joi.any().strip()
  }),
  oid: Joi.when('action', {
    is: 'add',
    then: Joi.string().guid().required().messages({
      'string.base': selectPerson,
      'string.empty': selectPerson,
      'string.guid': selectPerson,
      'any.required': selectPerson
    }),
    otherwise: Joi.any().strip()
  }),
  role: Joi.when('action', {
    is: 'add',
    then: roleField.required(),
    otherwise: roleField.default('user')
  })
})

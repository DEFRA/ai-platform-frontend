import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import {
  MAX_SEARCH_LENGTH,
  MIN_SEARCH_LENGTH,
  searchTeamPeople
} from './team-people.js'

const searchSchema = Joi.object({
  search: Joi.string()
    .trim()
    .min(MIN_SEARCH_LENGTH)
    .max(MAX_SEARCH_LENGTH)
    .required()
})

const MESSAGES = {
  invalid: `Enter ${MIN_SEARCH_LENGTH} to ${MAX_SEARCH_LENGTH} characters of a name or email address`,
  signedOut: 'Sign in to search for people',
  forbidden: 'Only an admin of this team can search for people',
  notFound: 'This team does not exist, or you are not a member',
  unavailable: 'We could not search the directory. Try again in a few minutes'
}

// Names and addresses: never cached by the browser or anything between.
function json(h, statusCode, body) {
  return h.response(body).code(statusCode).header('cache-control', 'no-store')
}

function refusal(h, error) {
  if (!(error instanceof ApiError)) {
    throw error
  }

  if (error.statusCode === statusCodes.forbidden) {
    return json(h, statusCodes.forbidden, { message: MESSAGES.forbidden })
  }

  if (error.statusCode === statusCodes.notFound) {
    return json(h, statusCodes.notFound, { message: MESSAGES.notFound })
  }

  // The directory is down, the backend cannot be reached, or it failed: the
  // box can do nothing more than say so.
  return json(h, statusCodes.serviceUnavailable, {
    message: MESSAGES.unavailable
  })
}

/**
 * The search behind the add-member page's combobox: the people an admin of
 * the team could add, as JSON. It is a POST so that what was typed is never
 * in an address, and nothing here logs it. The CSRF token comes in a header,
 * from the page's own form. Signed out is answered with a 401 the page can
 * act on, rather than the redirect to sign in that other pages get.
 */
export const peopleSearchController = {
  options: {
    app: { public: true },
    plugins: { crumb: { restful: true } },
    validate: {
      payload: searchSchema,
      failAction: (_request, h) =>
        json(h, statusCodes.badRequest, {
          message: MESSAGES.invalid
        }).takeover()
    }
  },
  async handler(request, h) {
    if (!getSessionUser(request)) {
      return json(h, statusCodes.unauthorized, { message: MESSAGES.signedOut })
    }

    try {
      const people = await searchTeamPeople(
        request,
        request.params.slug,
        request.payload.search
      )

      return json(h, statusCodes.ok, {
        items: people.map(({ oid, displayName, email }) => ({
          oid,
          displayName,
          email
        }))
      })
    } catch (error) {
      return refusal(h, error)
    }
  }
}

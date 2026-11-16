import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient } from '#/server/common/helpers/api-client.js'
import {
  environmentFromAddress,
  environmentPageUrl
} from '#/server/common/helpers/environment-names.js'
import { isPlaceholderCredential } from '#/server/common/helpers/placeholder-credential.js'
import {
  clearPendingClientSecret,
  getPendingClientSecret,
  setAccountNotification,
  setAddedClientSecret,
  setPendingClientSecret,
  takeAddedClientSecretIf
} from '#/server/common/helpers/session.js'
import { isNotFound, loadTeamForView } from '#/server/routes/teams/team-view.js'
import {
  addableSecret,
  buildAddedSecret,
  clientSecretAddUrl,
  clientSecretAddedUrl
} from './client-secrets-view.js'
import { environmentNotFound, errorPage, teamNotFound } from './error-views.js'
import {
  isUnavailable,
  postTeamClientSecret,
  readTeamEnvironment
} from './environments-api.js'

const SECRET_NAME = 'client secret'
const ENVIRONMENT_NOT_AVAILABLE = 'environment-not-available'
const LIMIT_REACHED = 'credential-limit-reached'
const MAX_NAME_LENGTH = 30
const NAME_FIELD = 'name'
const NAME_CHARACTERS_MESSAGE =
  'Name must only include letters, numbers, spaces, hyphens, underscores and full stops'

// The form carries the key its page was shown with, so submitting it again
// (a double click, a retry after a timeout) is the same request to the
// backend, which adds one secret. It is the shape the backend takes. The name
// is optional: trimmed, a blank one is no name, else 1 to 30 characters of
// letters, numbers, spaces, hyphens, underscores and full stops (the backend
// holds it to the same, and gives it to Entra as the secret's description).
const addSchema = Joi.object({
  key: Joi.string().guid({ version: 'uuidv4' }).required(),
  [NAME_FIELD]: Joi.string()
    .trim()
    .empty('')
    .max(MAX_NAME_LENGTH)
    .pattern(/^[A-Za-z0-9 _.-]+$/)
    .messages({
      'string.base': NAME_CHARACTERS_MESSAGE,
      'string.max': `Name must be ${MAX_NAME_LENGTH} characters or fewer`,
      'string.pattern.base': NAME_CHARACTERS_MESSAGE
    })
})

// What each refusal of an add says, by the backend's code: on the page that
// confirms it and, after a post, as a banner on the environment's page.
const REFUSALS = {
  'client-secrets-not-allowed': (name) => ({
    heading: `You cannot add a client secret in ${name}`,
    message: `Client secrets are not available in ${name}. Applications there use a passwordless credential.`
  }),
  'environment-not-set-up': (name) => ({
    heading: `${name} is not set up yet`,
    message: `Deploy a model in ${name} first. You can add a client secret once it is set up.`
  }),
  'credential-limit-reached': (name) => ({
    heading: `${name} has the most client secrets it can`,
    message: `Your team already has the most client secrets it can in ${name}. Revoke one, or wait for one to expire, to add another.`
  }),
  'admin-required': (name) => ({
    heading: 'You cannot add a client secret',
    message: `Only a team admin can add a client secret in ${name}.`
  }),
  'idempotency-key-reused': (name) => ({
    heading: 'Try adding the client secret again',
    message: `That request could not be used to add a client secret in ${name}. Try adding it again.`
  })
}

function backTo(slug, environment) {
  return {
    href: environmentPageUrl(slug, environment.environment),
    text: `Back to ${environment.registryName}`
  }
}

function redirectTo(h, url) {
  return h.redirect(url).code(statusCodes.seeOther)
}

function unavailable(h, { slug, environment, retryUrl }) {
  return errorPage(h, {
    status: statusCodes.serviceUnavailable,
    heading: 'Client secrets are not available just now',
    message: `We could not read ${environment.registryName} just now. Try again in a moment.`,
    back: {
      href: retryUrl ?? backTo(slug, environment).href,
      text: 'Try again'
    }
  })
}

// The page to show instead, when the backend refused or failed a read: the
// same 404 for a team that is not the person's as for one that does not
// exist.
function readFailed(request, h, error, { slug, environment, retryUrl }) {
  if (isNotFound(error)) {
    return error.code === ENVIRONMENT_NOT_AVAILABLE
      ? environmentNotFound(h, slug)
      : teamNotFound(h)
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not read an environment')

    return unavailable(h, { slug, environment, retryUrl })
  }

  throw error
}

function adminRequired(h, { slug, environment }) {
  const { heading, message } = REFUSALS['admin-required'](
    environment.registryName
  )

  return errorPage(h, {
    status: statusCodes.forbidden,
    heading,
    message,
    back: backTo(slug, environment)
  })
}

// An add that cannot be made now, as a page (the confirmation is not shown).
function refusedPage(h, code, { team, environment }) {
  const { heading, message } = REFUSALS[code](environment.registryName)

  return errorPage(h, {
    status: statusCodes.conflict,
    heading,
    message,
    back: backTo(team.slug, environment)
  })
}

/**
 * What the pages need before they show: the environment of the address and
 * the team with whether the person is an admin, or the `page` to show instead
 * (404 for an environment or team that is not theirs, 403 for a member, 503
 * when the backend failed). Only an admin adds a client secret; the backend
 * refuses everyone else too.
 */
async function loadAdmin(request, h, { withDetail, retryUrl }) {
  const { slug } = request.params
  const environment = environmentFromAddress(request.params.environment)

  if (!environment) {
    return { page: environmentNotFound(h, slug) }
  }

  let detail
  let loaded

  try {
    detail = withDetail
      ? await readTeamEnvironment(request, slug, environment.environment)
      : undefined
    loaded = await loadTeamForView(request, slug)
  } catch (error) {
    return {
      page: readFailed(request, h, error, { slug, environment, retryUrl })
    }
  }

  if (!loaded.isAdmin) {
    return { page: adminRequired(h, { slug, environment }) }
  }

  return { team: loaded.team, environment, detail }
}

function addView(
  h,
  { team, environment, detail, key, name, errorMessage, nameError }
) {
  const heading = `Add a client secret in ${environment.registryName}`
  const { count } = addableSecret(detail)
  const back = backTo(team.slug, environment)
  const errorSummary = errorMessage
    ? [{ text: errorMessage, href: '#add-client-secret' }]
    : null

  return h.view('environments/client-secret-add', {
    pageTitle: `${errorMessage || nameError ? 'Error: ' : ''}${heading}`,
    heading,
    caption: team.name,
    backLink: back.href,
    cancelUrl: back.href,
    formAction: clientSecretAddUrl(team.slug, environment.environment),
    key,
    name,
    countText: count.countText,
    environmentName: environment.registryName,
    errorSummary: nameError
      ? [{ text: nameError, href: `#${NAME_FIELD}` }]
      : errorSummary,
    nameError: nameError ? { text: nameError } : null
  })
}

// The add of this team's environment that was asked for and not answered, if
// there is one: the same key and name are used again, so the backend adds one
// secret whether or not the first request was made.
function pendingAddFor(request, slug, environment) {
  const pending = getPendingClientSecret(request)

  return pending?.slug === slug &&
    pending.environment === environment.environment
    ? pending
    : undefined
}

// The code that stops an add being offered. A full team does not stop one that
// is waiting to be answered: it may be the add that filled the last place, and
// asking again with its key only says what it did.
function blockingCode(detail, pending) {
  const { code } = addableSecret(detail)

  return pending && code === LIMIT_REACHED ? null : code
}

// The backend failed, and the add may or may not have been made: the key and
// name are kept in the session, so trying again (here, or from the page again
// if this one cannot be read) is the same request.
async function addAgain(request, h, { slug, environment, key, name }) {
  const result = await loadAdmin(request, h, {
    withDetail: true,
    retryUrl: clientSecretAddUrl(slug, environment.environment)
  })

  if (result.page) {
    return result.page
  }

  const code = blockingCode(result.detail, { key })

  if (code) {
    return refusedPage(h, code, result)
  }

  return addView(h, {
    ...result,
    key,
    name,
    errorMessage:
      'We could not add a client secret just now. Try again in a moment.'
  }).code(statusCodes.serviceUnavailable)
}

// A refusal the person can read becomes a banner on the environment's page;
// anything else is a fault. An add that is answered, or refused for good, is
// no longer waiting.
async function failed(request, h, error, { slug, environment, key, name }) {
  if (isNotFound(error)) {
    clearPendingClientSecret(request)

    return readFailed(request, h, error, { slug, environment })
  }

  if (isUnavailable(error)) {
    request.logger.warn({ err: error }, 'Could not add a client secret')

    return addAgain(request, h, { slug, environment, key, name })
  }

  const refusal = REFUSALS[error.code]

  if (!refusal) {
    throw error
  }

  clearPendingClientSecret(request)
  setAccountNotification(request, {
    type: 'error',
    message: refusal(environment.registryName).message
  })

  return redirectTo(h, backTo(slug, environment).href)
}

// Whether the one-time result in the session is the secret this page is for.
function isAddedHere(slug, environment) {
  return (issued) =>
    issued.teamSlug === slug &&
    issued.credential?.environment === environment.environment
}

// Whether the mock issuer made the secret, which is shown but does not work
// with the gateway. The add does not say; the credential does.
async function readPlaceholder(request, credentialId) {
  const credential = await apiClient(request).get(
    `/v1/credentials/${encodeURIComponent(credentialId)}`
  )

  return isPlaceholderCredential(credential)
}

// A form without its key (forged, or an old page) is shown again, with a key of
// its own. One with a name that cannot be used is shown again as it was, with
// the error, unless the person may not add a secret here after all.
async function invalidAdd(request, h, error) {
  const [{ path, message }] = error.details

  if (path[0] !== NAME_FIELD) {
    return redirectTo(
      h,
      clientSecretAddUrl(request.params.slug, request.params.environment)
    ).takeover()
  }

  const result = await loadAdmin(request, h, { withDetail: true })

  if (result.page) {
    return result.page.takeover()
  }

  const { code } = addableSecret(result.detail)

  if (code) {
    return refusedPage(h, code, result).takeover()
  }

  const { key, name } = request.payload

  return addView(h, {
    ...result,
    key,
    name: typeof name === 'string' ? name : undefined,
    nameError: message
  })
    .code(statusCodes.badRequest)
    .takeover()
}

/**
 * An admin adds a client secret in one environment: a page that says what
 * will happen, the add with a key that makes asking again the same request,
 * and the page that shows the secret once. The backend decides everything
 * else (where client secrets are allowed, the limit, who may) and its
 * refusals are said in words on the environment's page.
 */
export const clientSecretAddController = {
  add: {
    get: {
      async handler(request, h) {
        const result = await loadAdmin(request, h, { withDetail: true })

        if (result.page) {
          return result.page
        }

        const pending = pendingAddFor(
          request,
          request.params.slug,
          result.environment
        )
        const code = blockingCode(result.detail, pending)

        return code
          ? refusedPage(h, code, result)
          : addView(h, {
              ...result,
              key: pending?.key ?? randomUUID(),
              name: pending?.name
            })
      }
    },
    post: {
      options: {
        validate: {
          payload: addSchema,
          failAction: invalidAdd
        }
      },
      async handler(request, h) {
        const { slug } = request.params
        const environment = environmentFromAddress(request.params.environment)

        if (!environment) {
          return environmentNotFound(h, slug)
        }

        const { key, name } = request.payload

        setPendingClientSecret(request, {
          slug,
          environment: environment.environment,
          key,
          name
        })

        try {
          const { credential, secret } = await postTeamClientSecret(
            request,
            slug,
            environment.environment,
            key,
            name
          )

          clearPendingClientSecret(request)

          // A replay (the key was used for this add already) has no value:
          // the first answer's is shown, if it is still to be shown.
          if (secret) {
            setAddedClientSecret(request, {
              secret,
              credential,
              secretName: SECRET_NAME,
              teamSlug: slug
            })
          }
        } catch (error) {
          return failed(request, h, error, { slug, environment, key, name })
        }

        return redirectTo(
          h,
          clientSecretAddedUrl(slug, environment.environment)
        )
      }
    }
  },

  added: {
    get: {
      async handler(request, h) {
        const { slug } = request.params

        // Who may see it is decided again here, before the one-time result is
        // taken: the person may have lost admin since they asked.
        const result = await loadAdmin(request, h, { withDetail: false })

        if (result.page) {
          return result.page
        }

        const { team, environment } = result
        const issued = takeAddedClientSecretIf(
          request,
          isAddedHere(slug, environment)
        )
        const addedUrl = clientSecretAddedUrl(slug, environment.environment)

        if (!issued) {
          setAccountNotification(request, {
            type: 'info',
            message:
              'A client secret is shown once, when it is added. If you did not copy it, use View on its row to see it again.'
          })

          return redirectTo(h, backTo(slug, environment).href)
        }

        let placeholderCredential

        try {
          placeholderCredential = await readPlaceholder(
            request,
            issued.credential.id
          )
        } catch (error) {
          // Nothing has been shown yet: it stays to be shown when the page is
          // loaded again.
          setAddedClientSecret(request, issued)

          if (isUnavailable(error)) {
            request.logger.warn({ err: error }, 'Could not read a credential')

            return unavailable(h, { slug, environment, retryUrl: addedUrl })
          }

          throw error
        }

        return h
          .view('environments/client-secret-added', {
            pageTitle: 'Client secret added',
            ...buildAddedSecret({
              team,
              environment,
              issued,
              placeholderCredential
            })
          })
          .header('cache-control', 'no-store')
      }
    }
  }
}

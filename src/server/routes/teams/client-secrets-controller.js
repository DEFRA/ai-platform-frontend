import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { credentialEnvironmentName } from '#/server/common/helpers/environment-names.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import { isPlaceholderCredential } from '#/server/common/helpers/placeholder-credential.js'
import {
  revealSchema,
  revokeConfirmSchema
} from '#/server/common/helpers/credential-schemas.js'
import {
  getSessionUser,
  setAccountNotification,
  setIssuedCredential,
  takeIssuedCredentialIf
} from '#/server/common/helpers/session.js'
import { joinNames } from '#/server/routes/connect/team-model-choices.js'
import { isNotFound, loadTeamForView, teamUrl } from './team-view.js'

const SECRET_NAME = 'client secret'

function clientSecretNotFound(h, slug) {
  return h
    .view('error/index', {
      pageTitle: 'Client secret not found',
      heading: 'Client secret not found',
      message:
        'This client secret is not one of this team’s, or you are not an admin of the team.',
      actionHref: teamUrl({ slug }),
      actionText: 'Back to the team'
    })
    .code(statusCodes.notFound)
}

function secretUrl(slug, credentialId, step) {
  return `${teamUrl({ slug })}/client-secrets/${encodeURIComponent(credentialId)}/${step}`
}

// The team and its client secret, when the secret is the team's and the
// person is one of its admins (only an admin can view, rotate or revoke it);
// otherwise null, which reads as not found.
async function loadClientSecret(request) {
  const { slug, credentialId } = request.params
  const userId = getSessionUser(request).id
  let loaded
  let credential

  try {
    loaded = await loadTeamForView(request, slug)
    credential = await apiClient(request).get(
      `/v1/credentials/${encodeURIComponent(credentialId)}`,
      { userId }
    )
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }

    throw error
  }

  const { team, isAdmin } = loaded

  if (
    !isAdmin ||
    credential.tier !== 'team' ||
    credential.teamId !== team._id
  ) {
    return null
  }

  return { team, credential }
}

// The models the secret covers, named, for the pages that confirm what a
// change to it affects.
async function coveredModelNames(request, credential) {
  const slugs = credential.allowedDeployments ?? []

  if (slugs.length === 0) {
    return 'this team’s models'
  }

  const { items } = await apiClient(request).get(
    '/v1/models?includeIneligible=true'
  )
  const names = Object.fromEntries(
    items.map((model) => [model.slug, model.displayName])
  )

  return joinNames(slugs.map((slug) => names[slug] ?? slug))
}

// A form that failed validation shows the page again with its errors, and
// stops the request there; a client secret that is not the person's to
// change stays the not found page.
function takeoverFailure(view) {
  const response =
    view.statusCode === statusCodes.notFound
      ? view
      : view.code(statusCodes.badRequest)

  return response.takeover()
}

// A refusal the person can read becomes a banner on the Models tab; a
// backend fault goes to the error page like everywhere else.
function failAsBanner(request, h, error, message) {
  if (
    !(error instanceof ApiError) ||
    error.statusCode >= statusCodes.internalServerError
  ) {
    throw error
  }

  setAccountNotification(request, { type: 'error', message })

  return h
    .redirect(teamUrl({ slug: request.params.slug }))
    .code(statusCodes.seeOther)
}

function revealErrorMessage(error) {
  if (error.code === 'admin-required') {
    return 'Only a team admin can view this client secret.'
  }

  return error.code === 'credential-revoked'
    ? 'This client secret has been revoked.'
    : 'This client secret could not be found.'
}

async function revealView(request, h, { error, values } = {}) {
  const page = await loadClientSecret(request)

  if (!page) {
    return clientSecretNotFound(h, request.params.slug)
  }

  const heading = `View the ${credentialEnvironmentName(page.credential)} ${SECRET_NAME} for ${page.team.name}`

  return h.view('manage/reveal', {
    pageTitle: `${error ? 'Error: ' : ''}${heading}`,
    heading,
    secretName: SECRET_NAME,
    backHref: teamUrl(page.team),
    values: values ?? { reason: '' },
    errorSummary: error ? buildErrorSummary(error) : null,
    fieldErrors: error ? buildFieldErrors(error) : {}
  })
}

async function revokeView(request, h, error) {
  const page = await loadClientSecret(request)

  if (!page) {
    return clientSecretNotFound(h, request.params.slug)
  }

  const models = await coveredModelNames(request, page.credential)
  const environment = credentialEnvironmentName(page.credential)
  const heading = `Are you sure you want to revoke the ${page.team.name} ${SECRET_NAME}?`

  return h.view('manage/revoke', {
    pageTitle: `${error ? 'Error: ' : ''}Confirm revoke`,
    heading,
    backHref: teamUrl(page.team),
    warning: `Revoking the ${environment} ${SECRET_NAME} cannot be undone. Anything using it to reach ${models} stops working straight away.`,
    legend: `Are you sure you want to revoke the ${environment} ${SECRET_NAME}?`,
    yesText: `Yes, revoke the ${SECRET_NAME}`,
    noText: `No, take me back to ${page.team.name}`,
    errorSummary: error ? buildErrorSummary(error) : null,
    fieldErrors: error ? buildFieldErrors(error) : {}
  })
}

/**
 * A team's client secret, on the team's own routes: an admin shows it (with a
 * reason, recorded), rotates it or revokes it. The backend decides what an
 * admin may do and refuses everyone else; a member is told to ask an admin,
 * on the Models tab, and reaches none of these. Back and cancel return to the
 * Models tab.
 */
export const clientSecretsController = {
  reveal: {
    get: {
      handler: (request, h) => revealView(request, h)
    },
    post: {
      options: {
        validate: {
          payload: revealSchema,
          failAction: async (request, h, error) =>
            takeoverFailure(
              await revealView(request, h, {
                error,
                values: request.payload
              })
            )
        }
      },
      async handler(request, h) {
        const page = await loadClientSecret(request)
        const { slug, credentialId } = request.params

        if (!page) {
          return clientSecretNotFound(h, slug)
        }

        try {
          const { secret } = await apiClient(request).post(
            `/v1/credentials/${encodeURIComponent(credentialId)}/reveal`,
            { reason: request.payload.reason },
            { userId: getSessionUser(request).id }
          )

          setIssuedCredential(request, {
            secret,
            credentialId,
            secretName: SECRET_NAME,
            placeholderCredential: isPlaceholderCredential(page.credential)
          })

          return h
            .redirect(secretUrl(slug, credentialId, 'revealed'))
            .code(statusCodes.seeOther)
        } catch (error) {
          return failAsBanner(request, h, error, revealErrorMessage(error))
        }
      }
    }
  },

  revealed: {
    get: {
      async handler(request, h) {
        const { slug, credentialId } = request.params

        // Who may see it is decided again here, before the one-time result is
        // taken: the session slot is shared with personal keys and other
        // teams, and the person may have lost admin since they asked.
        if (!(await loadClientSecret(request))) {
          return clientSecretNotFound(h, slug)
        }

        const issued = takeIssuedCredentialIf(
          request,
          (result) => result.credentialId === credentialId
        )

        if (!issued) {
          return h.redirect(teamUrl({ slug })).code(statusCodes.seeOther)
        }

        return h
          .view('manage/revealed', {
            pageTitle: `Your ${issued.secretName}`,
            heading: `Your ${issued.secretName}`,
            secretName: issued.secretName,
            placeholderCredential: issued.placeholderCredential,
            secret: issued.secret,
            returnHref: teamUrl({ slug }),
            returnText: 'Back to the team'
          })
          .header('cache-control', 'no-store')
      }
    }
  },

  rotate: {
    get: {
      async handler(request, h) {
        const page = await loadClientSecret(request)

        if (!page) {
          return clientSecretNotFound(h, request.params.slug)
        }

        return h.view('teams/rotate', {
          pageTitle: 'Confirm rotate',
          heading: `Are you sure you want to rotate the ${page.team.name} client secret?`,
          teamUrl: teamUrl(page.team),
          teamName: page.team.name,
          credential: page.credential,
          environmentName: credentialEnvironmentName(page.credential),
          modelNamesText: await coveredModelNames(request, page.credential)
        })
      }
    },
    post: {
      async handler(request, h) {
        const page = await loadClientSecret(request)
        const { slug, credentialId } = request.params

        if (!page) {
          return clientSecretNotFound(h, slug)
        }

        const modelNamesText = await coveredModelNames(request, page.credential)

        try {
          const { credential, secret } = await apiClient(request).post(
            `/v1/credentials/${encodeURIComponent(credentialId)}/rotate`,
            undefined,
            { userId: getSessionUser(request).id }
          )

          setIssuedCredential(request, { credential, secret, modelNamesText })

          return h
            .redirect(secretUrl(slug, credentialId, 'rotated'))
            .code(statusCodes.seeOther)
        } catch (error) {
          return failAsBanner(
            request,
            h,
            error,
            error.code === 'admin-required'
              ? 'Only a team admin can rotate this client secret.'
              : 'This client secret could not be rotated.'
          )
        }
      }
    }
  },

  rotated: {
    get: {
      async handler(request, h) {
        const { slug, credentialId } = request.params

        // As for the revealed secret: decided again before the one-time
        // result is taken.
        if (!(await loadClientSecret(request))) {
          return clientSecretNotFound(h, slug)
        }

        const issued = takeIssuedCredentialIf(
          request,
          (result) => result.credential?._id === credentialId
        )

        if (!issued) {
          return h.redirect(teamUrl({ slug })).code(statusCodes.seeOther)
        }

        return h
          .view('teams/rotated', {
            pageTitle: 'Client secret rotated',
            heading: 'Client secret rotated',
            teamUrl: teamUrl({ slug }),
            credential: issued.credential,
            placeholderCredential: isPlaceholderCredential(issued.credential),
            secret: issued.secret,
            modelNamesText: issued.modelNamesText
          })
          .header('cache-control', 'no-store')
      }
    }
  },

  revoke: {
    get: {
      handler: (request, h) => revokeView(request, h)
    },
    post: {
      options: {
        validate: {
          payload: revokeConfirmSchema,
          failAction: async (request, h, error) =>
            takeoverFailure(await revokeView(request, h, error))
        }
      },
      async handler(request, h) {
        const { slug, credentialId } = request.params
        const page = await loadClientSecret(request)

        if (!page) {
          return clientSecretNotFound(h, slug)
        }

        if (request.payload.confirmRevoke === 'yes') {
          try {
            await apiClient(request).del(
              `/v1/credentials/${encodeURIComponent(credentialId)}`,
              { userId: getSessionUser(request).id }
            )

            setAccountNotification(request, {
              type: 'success',
              message: 'Client secret revoked.'
            })
          } catch (error) {
            return failAsBanner(
              request,
              h,
              error,
              error.code === 'admin-required'
                ? 'Only a team admin can revoke this client secret.'
                : 'This client secret could not be revoked.'
            )
          }
        }

        return h.redirect(teamUrl({ slug })).code(statusCodes.seeOther)
      }
    }
  }
}

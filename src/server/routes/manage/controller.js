import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { buildGatewayRequest } from '#/server/common/helpers/gateway-request.js'
import {
  setAccountNotification,
  takeAccountNotification,
  setIssuedCredential,
  takeIssuedCredentialIf
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  credentialEnvironment,
  credentialEnvironmentName
} from '#/server/common/helpers/environment-names.js'
import {
  revealSchema,
  revokeConfirmSchema
} from '#/server/common/helpers/credential-schemas.js'
import {
  RESEARCH_CREDENTIAL_DAYS,
  RESEARCH_RENEWAL_CAP
} from '#/server/common/constants/research-access.js'
import { readKeyUsage } from '#/server/routes/usage/usage-api.js'
import {
  filterBarOf,
  periodSelectOf
} from '#/server/common/helpers/filter-bar.js'
import { usageDaysOf } from '#/server/common/helpers/usage-format.js'
import { buildKeyRows, notificationBannerParams } from './access-view.js'
import { KEY_USAGE_DAYS, keyUsageOf } from './key-usage-view.js'

const SECRET_NAME = 'key'
const TEAM_TIER = 'team'

// Only the credential's own model is looked up, so this stays a single call
// rather than fetching the whole catalogue for a one-row confirm page.
async function findModel(request, modelSlug) {
  return apiClient(request).get(`/v1/models/${modelSlug}`)
}

// A personal research key, or null when the id is not one of the person's
// keys. A team's client secret is the team's to manage, on the team's own
// routes, so it is not found here whatever the API would allow.
async function findResearchCredential(request, id) {
  let credential

  try {
    credential = await apiClient(request).get(`/v1/credentials/${id}`)
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }

  return credential.tier === TEAM_TIER ? null : credential
}

// The words of the revoke confirmation: the key, and what revoking costs.
async function revokeContent(request, credential) {
  const model = await findModel(request, credential.modelSlug)

  return {
    heading: 'Are you sure you want to revoke this credential?',
    warning: `Revoking ${model.displayName} cannot be undone. You will need to connect again to get a new credential.`,
    legend: 'Are you sure you want to revoke this credential?',
    yesText: 'Yes, revoke this credential',
    noText: 'No, take me back to personal access'
  }
}

async function readModels(request) {
  const { items } = await apiClient(request).get('/v1/models')

  return {
    names: Object.fromEntries(
      items.map((model) => [model.slug, model.displayName])
    ),
    allowances: Object.fromEntries(
      items.map((model) => [model.slug, model.limitsDefault?.tokensPerDay])
    )
  }
}

// Each working key's use over the last `days` days. One that cannot be read is
// null, so the page says so for that key and still shows the rest.
async function readKeyUsages(request, keyRows, days) {
  const reads = await Promise.allSettled(
    keyRows.map((row) =>
      row.expired ? null : readKeyUsage(request, row._id, days)
    )
  )

  reads.forEach((read) => {
    if (read.status === 'rejected') {
      request.logger.warn({ err: read.reason }, 'Could not read a key’s usage')
    }
  })

  return reads.map((read) => read.value ?? null)
}

function isNotFound(error) {
  return error instanceof ApiError && error.statusCode === statusCodes.notFound
}

export const manageController = {
  list: {
    get: {
      async handler(request, h) {
        const [{ items }, models] = await Promise.all([
          apiClient(request).get('/v1/credentials'),
          readModels(request)
        ])
        const keyRows = buildKeyRows(items, models.names)
        const days = usageDaysOf(request.query.days, KEY_USAGE_DAYS)
        const usages = await readKeyUsages(request, keyRows, days)

        return h.view('manage/index', {
          pageTitle: 'Personal access',
          heading: 'Personal access',
          researchDays: RESEARCH_CREDENTIAL_DAYS,
          renewalCap: RESEARCH_RENEWAL_CAP,
          keyRows,
          keyUsage: keyUsageOf(keyRows, usages, models.allowances, days),
          filterBar: filterBarOf({
            action: '/manage#your-usage',
            selects: [periodSelectOf(days)],
            hint: 'Choosing a period updates the usage. With a keyboard, press Enter after choosing.'
          }),
          notificationBanner: notificationBannerParams(
            takeAccountNotification(request)
          )
        })
      }
    }
  },
  view: {
    get: {
      async handler(request, h) {
        const { id } = request.params
        const credential = await findResearchCredential(request, id)

        if (!credential) {
          return h
            .view('error/index', {
              pageTitle: 'Credential not found',
              heading: 'Credential not found',
              message:
                'This credential does not exist, or you do not have access to it.',
              actionHref: '/manage',
              actionText: 'Go to personal access'
            })
            .code(statusCodes.notFound)
        }

        const model = await findModel(request, credential.modelSlug)
        const heading = model.displayName

        return h.view('manage/credential', {
          pageTitle: heading,
          heading,
          credential,
          environmentName: credentialEnvironmentName(credential),
          models: [
            {
              ...model,
              gatewayEndpoint: buildGatewayRequest(
                model,
                credentialEnvironment(credential)
              ).endpoint
            }
          ]
        })
      }
    }
  },

  renew: {
    post: {
      async handler(request, h) {
        const { id } = request.params

        try {
          const credential = await apiClient(request).post(
            `/v1/credentials/${id}/renew`
          )

          setAccountNotification(request, {
            type: 'success',
            message: `Credential renewed. New expiry: ${credential.expiresAt}`
          })
        } catch (error) {
          if (!(error instanceof ApiError)) {
            throw error
          }

          if (!isNotFound(error)) {
            setAccountNotification(request, {
              type: 'error',
              message: error.message
            })
          }
        }

        return h.redirect('/manage').code(statusCodes.seeOther)
      }
    }
  },

  revoke: {
    get: {
      async handler(request, h) {
        const credential = await findResearchCredential(
          request,
          request.params.id
        )

        if (!credential) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        return h.view('manage/revoke', {
          pageTitle: 'Confirm revoke',
          ...(await revokeContent(request, credential)),
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },

    post: {
      options: {
        validate: {
          payload: revokeConfirmSchema,
          failAction: async (request, h, error) => {
            const credential = await findResearchCredential(
              request,
              request.params.id
            )

            if (!credential) {
              return h.redirect('/manage').code(statusCodes.seeOther).takeover()
            }

            return h
              .view('manage/revoke', {
                pageTitle: 'Error: Confirm revoke',
                ...(await revokeContent(request, credential)),
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      async handler(request, h) {
        const { id } = request.params

        if (request.payload.confirmRevoke === 'yes') {
          if (!(await findResearchCredential(request, id))) {
            return h.redirect('/manage').code(statusCodes.seeOther)
          }

          try {
            await apiClient(request).del(`/v1/credentials/${id}`)

            setAccountNotification(request, {
              type: 'success',
              message: 'Credential revoked.'
            })
          } catch (error) {
            if (!(error instanceof ApiError) || !isNotFound(error)) {
              throw error
            }
          }
        }

        return h.redirect('/manage').code(statusCodes.seeOther)
      }
    }
  },

  reveal: {
    get: {
      async handler(request, h) {
        const credential = await findResearchCredential(
          request,
          request.params.id
        )

        if (!credential) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        const model = await findModel(request, credential.modelSlug)

        return h.view('manage/reveal', {
          pageTitle: `View the full ${SECRET_NAME}`,
          heading: `View the full ${SECRET_NAME} for ${model.displayName}`,
          secretName: SECRET_NAME,
          values: { reason: '' },
          errorSummary: null,
          fieldErrors: {}
        })
      }
    },

    post: {
      options: {
        validate: {
          payload: revealSchema,
          failAction: async (request, h, error) => {
            const credential = await findResearchCredential(
              request,
              request.params.id
            )

            if (!credential) {
              return h.redirect('/manage').code(statusCodes.seeOther).takeover()
            }

            const model = await findModel(request, credential.modelSlug)

            return h
              .view('manage/reveal', {
                pageTitle: `Error: View the full ${SECRET_NAME}`,
                heading: `View the full ${SECRET_NAME} for ${model.displayName}`,
                secretName: SECRET_NAME,
                values: request.payload,
                errorSummary: buildErrorSummary(error),
                fieldErrors: buildFieldErrors(error)
              })
              .code(statusCodes.badRequest)
              .takeover()
          }
        }
      },
      async handler(request, h) {
        const { id } = request.params
        const credential = await findResearchCredential(request, id)

        if (!credential) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        try {
          const { secret } = await apiClient(request).post(
            `/v1/credentials/${id}/reveal`,
            { reason: request.payload.reason }
          )

          setIssuedCredential(request, {
            secret,
            credentialId: id,
            secretName: SECRET_NAME
          })

          return h
            .redirect(`/manage/credentials/${id}/revealed`)
            .code(statusCodes.seeOther)
        } catch (error) {
          if (!(error instanceof ApiError)) {
            throw error
          }

          setAccountNotification(request, {
            type: 'error',
            message:
              error.code === 'credential-revoked'
                ? 'This credential has been revoked.'
                : 'This credential could not be found.'
          })

          return h.redirect('/manage').code(statusCodes.seeOther)
        }
      }
    }
  },

  revealed: {
    get: {
      handler(request, h) {
        // The slot is shared with a team's secrets, which are shown only on
        // the team's own routes; a result for another page is left for it.
        const issued = takeIssuedCredentialIf(
          request,
          (result) =>
            result.credentialId === request.params.id &&
            result.secretName === SECRET_NAME
        )

        if (!issued) {
          return h.redirect('/manage').code(statusCodes.seeOther)
        }

        return h
          .view('manage/revealed', {
            pageTitle: `Your ${issued.secretName}`,
            heading: `Your ${issued.secretName}`,
            secretName: issued.secretName,
            secret: issued.secret,
            returnHref: `/manage/credentials/${issued.credentialId}`,
            returnText: 'Back to this credential'
          })
          .header('cache-control', 'no-store')
      }
    }
  }
}

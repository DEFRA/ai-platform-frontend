import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { buildGatewayRequest } from '#/server/common/helpers/gateway-request.js'
import {
  formatLabel,
  formatLabelList
} from '#/config/nunjucks/filters/format-label.js'

const listQuerySchema = Joi.object({
  provider: Joi.string().trim().lowercase().optional(),
  tier: Joi.string().trim().lowercase().optional()
}).unknown(false)

const slugParamSchema = Joi.object({
  slug: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .required()
}).unknown(false)

// With no tier filter a model counts as eligible if it offers any tier we sell.
const OFFERED_TIERS = ['research', 'team']

function isModelEligible(model, tier) {
  const tiers = model.tiers ?? []
  const requiredTiers = tier ? [tier] : OFFERED_TIERS

  return (
    model.eligible !== false &&
    requiredTiers.some((required) => tiers.includes(required))
  )
}

// The catalogue page shows ineligible/retired models greyed out rather than
// hiding them, so it always asks the backend to include them, then explains
// why with whatever the catalogue sync already carries.
function statusReasonFor(model) {
  if (model.lifecycle?.status === 'retired') {
    return 'Retired'
  }

  return model.eligibilityReason || 'Not approved yet'
}

function buildQueryString({ provider, tier }) {
  const params = new URLSearchParams()
  if (provider) {
    params.set('provider', provider)
  }
  if (tier) {
    params.set('tier', tier)
  }
  params.set('includeIneligible', 'true')
  return `?${params.toString()}`
}

function isDirectlyHosted(model) {
  return model.hosting?.platform === 'direct'
}

function hostingCaptionFor(model) {
  const provider = formatLabel(model.provider)

  return isDirectlyHosted(model)
    ? `${provider}, hosted by ${formatLabel(model.hosting.provider)}`
    : `${provider}, hosted by Defra in ${formatLabel(model.region)}`
}

function whereItRunsFor(model) {
  const dataZone = `${formatLabel(model.dataZone)} data zone`

  // A direct offering declares a data zone but has no regions[] to name.
  return isDirectlyHosted(model)
    ? dataZone
    : `${formatLabel(model.region)}, ${dataZone}`
}

function buildModelSummaryRows(model) {
  const rows = [
    { key: { text: 'Provider' }, value: { text: formatLabel(model.provider) } },
    { key: { text: 'Version' }, value: { text: `${model.version} (pinned)` } }
  ]

  if (model.limitsDefault?.requestsPerMinute) {
    rows.push({
      key: { text: 'Requests per minute' },
      value: { text: `${model.limitsDefault.requestsPerMinute}` }
    })
  }

  if (model.limitsDefault?.tokensPerDay) {
    rows.push({
      key: { text: 'Tokens per day' },
      value: { text: `${model.limitsDefault.tokensPerDay}` }
    })
  }

  rows.push(
    {
      key: { text: 'Where it runs' },
      value: { text: whereItRunsFor(model) }
    },
    { key: { text: 'Tiers' }, value: { text: formatLabelList(model.tiers) } }
  )

  return rows
}

export const modelsController = {
  list: {
    get: {
      options: {
        validate: { query: listQuerySchema }
      },
      async handler(request, h) {
        const { provider, tier } = request.query
        const { items } = await apiClient(request).get(
          `/v1/models${buildQueryString({ provider, tier })}`
        )

        return h.view('models/index', {
          pageTitle: 'Models',
          heading: 'Models',
          models: items.map((model) => {
            const eligible = isModelEligible(model, tier)
            return {
              ...model,
              eligible,
              statusReason: eligible ? undefined : statusReasonFor(model)
            }
          }),
          resultCount: items.length,
          filters: { provider: provider ?? '', tier: tier ?? '' }
        })
      }
    }
  },

  detail: {
    get: {
      options: {
        validate: { params: slugParamSchema }
      },
      async handler(request, h) {
        const { slug } = request.params

        let model
        try {
          model = await apiClient(request).get(`/v1/models/${slug}`)
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.statusCode === statusCodes.notFound
          ) {
            return h
              .view('error/index', {
                pageTitle: 'Model not found',
                heading: 'Model not found',
                message: 'This model does not exist or is no longer offered.',
                actionHref: '/models',
                actionText: 'Browse models'
              })
              .code(statusCodes.notFound)
          }

          throw error
        }

        const eligible = isModelEligible(model)

        return h.view('models/detail', {
          pageTitle: model.displayName,
          heading: model.displayName,
          model,
          eligible,
          statusReason: eligible ? undefined : statusReasonFor(model),
          canConnect: eligible,
          modelLocationCaption: hostingCaptionFor(model),
          summaryRows: buildModelSummaryRows(model),
          ...buildGatewayRequest(model)
        })
      }
    }
  }
}

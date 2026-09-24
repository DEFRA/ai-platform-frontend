import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'

const listQuerySchema = Joi.object({
  provider: Joi.string().trim().lowercase().optional(),
  tier: Joi.string().trim().lowercase().optional()
}).unknown(false)

const slugParamSchema = Joi.object({
  slug: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .required()
}).unknown(false)

// The backend only ever returns eligible: true models today, but the
// catalogue is designed to also show ineligible models (e.g. other
// providers/tiers not yet approved) greyed out, once the seed data grows.
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

function buildQueryString({ provider, tier }) {
  const params = new URLSearchParams()
  if (provider) {
    params.set('provider', provider)
  }
  if (tier) {
    params.set('tier', tier)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
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
          pageTitle: 'Browse models',
          heading: 'Browse models',
          models: items.map((model) => ({
            ...model,
            eligible: isModelEligible(model, tier)
          })),
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
          canConnect: eligible
        })
      }
    }
  }
}

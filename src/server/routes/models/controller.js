import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { RESEARCH_CREDENTIAL_DAYS } from '#/server/common/constants/research-access.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { buildGatewayRequest } from '#/server/common/helpers/gateway-request.js'
import { researchEnvironment } from '#/server/common/helpers/environment-names.js'
import { formatLabel } from '#/config/nunjucks/filters/format-label.js'
import {
  SHOW_OPTIONS,
  TEAM_AVAILABILITY,
  canTry,
  filterByShow,
  groupModels,
  isEligible,
  teamAvailability,
  teamUkRegion,
  unavailableReason,
  useCasesList,
  useCasesSentence
} from './model-availability.js'

// Anything else in the address (for example an old provider or tier filter)
// is ignored rather than refused.
const listQuerySchema = Joi.object({
  show: Joi.string()
    .valid(...Object.keys(SHOW_OPTIONS))
    .default('all')
}).unknown(true)

const slugParamSchema = Joi.object({
  slug: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .required()
}).unknown(false)

function sharedStartUrl(slug) {
  return `/connect/shared/start?modelSlug=${encodeURIComponent(slug)}`
}

function teamStartUrl(slug) {
  return `/connect/team/start?modelSlug=${encodeURIComponent(slug)}`
}

function buildShowItems(selected) {
  return Object.entries(SHOW_OPTIONS).map(([value, text]) => ({
    value,
    text,
    selected: value === selected
  }))
}

function buildModelRow(model) {
  return {
    slug: model.slug,
    displayName: model.displayName,
    goodFor: useCasesList(model.useCases),
    canTry: model.canTry,
    tryUrl: sharedStartUrl(model.slug),
    teamAvailability: model.teamAvailability,
    canAddToTeam: model.teamAvailability === TEAM_AVAILABILITY.inUk,
    addToTeamUrl: teamStartUrl(model.slug)
  }
}

function forATeamText(model) {
  const region = teamUkRegion(model)

  return region
    ? `A deployment just for your team, in ${formatLabel(region)}. Shared by the team through one client secret.`
    : teamAvailability(model)
}

function onYourOwnText(model) {
  return canTry(model)
    ? `A personal key for ${RESEARCH_CREDENTIAL_DAYS} days. Requests can be processed outside the UK, so do not use OFFICIAL-SENSITIVE data.`
    : 'Not available to try on your own yet.'
}

function versionText(model) {
  const pinned = 'Pinned, so it will not change under you.'

  return model.version ? `${model.version}. ${pinned}` : pinned
}

function buildUseRows(model) {
  return [
    { key: { text: 'For a team' }, value: { text: forATeamText(model) } },
    { key: { text: 'On your own' }, value: { text: onYourOwnText(model) } },
    { key: { text: 'Version' }, value: { text: versionText(model) } }
  ]
}

export const modelsController = {
  list: {
    get: {
      options: {
        validate: { query: listQuerySchema }
      },
      async handler(request, h) {
        const { show } = request.query
        const { items } = await apiClient(request).get(
          '/v1/models?includeIneligible=true'
        )
        const { available, notAvailable } = groupModels(items)

        return h.view('models/index', {
          pageTitle: 'Models',
          heading: 'Models',
          researchDays: RESEARCH_CREDENTIAL_DAYS,
          showItems: buildShowItems(show),
          models: filterByShow(available, show).map(buildModelRow),
          notAvailableRows:
            show === 'all'
              ? notAvailable.map((model) => ({
                  key: { text: model.displayName },
                  value: { text: model.reason }
                }))
              : []
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

        const eligible = isEligible(model)

        return h.view('models/detail', {
          pageTitle: model.displayName,
          heading: model.displayName,
          provider: formatLabel(model.provider),
          goodFor: useCasesSentence(model.useCases),
          eligible,
          statusReason: eligible ? undefined : unavailableReason(model),
          canAddToTeam:
            eligible && teamAvailability(model) === TEAM_AVAILABILITY.inUk,
          addToTeamUrl: teamStartUrl(model.slug),
          canTry: canTry(model),
          tryUrl: sharedStartUrl(model.slug),
          useRows: buildUseRows(model),
          ...buildGatewayRequest(model, researchEnvironment())
        })
      }
    }
  }
}

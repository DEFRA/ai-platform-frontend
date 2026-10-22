import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  getSessionUser,
  setAccountNotification,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import { adminRequiredView, loadAdminTeam } from './admin-team.js'
import { descriptionField, serviceCodeField } from './team-fields.js'
import {
  isForbidden,
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamTabs,
  teamUrl
} from './team-view.js'

// The two things on the Details tab an admin can change, each on its own page.
const CHANGES = {
  serviceCode: {
    path: 'service-code',
    heading: 'Change the service code',
    action: 'change the service code',
    success: 'Service code updated.',
    schema: Joi.object({ serviceCode: serviceCodeField })
  },
  description: {
    path: 'description',
    heading: 'Change what the team does',
    action: 'change what the team does',
    success: 'What the team does has been updated.',
    schema: Joi.object({ description: descriptionField })
  }
}

function detailsUrl(team) {
  return `${teamUrl(team)}/details`
}

function noErrors() {
  return { errorSummary: null, fieldErrors: {} }
}

function changeView(h, { team, field, value, errors = noErrors() }) {
  const { heading } = CHANGES[field]

  return h.view('teams/change-detail', {
    pageTitle: `${errors.errorSummary ? 'Error: ' : ''}${heading}`,
    heading,
    team,
    field,
    value,
    backUrl: detailsUrl(team),
    ...errors
  })
}

function changeController(field) {
  const { action, success, schema } = CHANGES[field]

  return {
    get: {
      async handler(request, h) {
        const { loaded, page } = await loadAdminTeam(
          request,
          h,
          action,
          'details'
        )

        return (
          page ??
          changeView(h, {
            team: loaded.team,
            field,
            value: loaded.team[field] ?? ''
          })
        )
      }
    },
    post: {
      options: {
        validate: {
          payload: schema,
          async failAction(request, h, error) {
            const { loaded, page } = await loadAdminTeam(
              request,
              h,
              action,
              'details'
            )

            return (
              page ??
              changeView(h, {
                team: loaded.team,
                field,
                value: request.payload?.[field] ?? '',
                errors: {
                  errorSummary: buildErrorSummary(error),
                  fieldErrors: buildFieldErrors(error)
                }
              }).code(statusCodes.badRequest)
            ).takeover()
          }
        }
      },
      async handler(request, h) {
        const { loaded, page } = await loadAdminTeam(
          request,
          h,
          action,
          'details'
        )

        if (page) {
          return page
        }

        const { team } = loaded

        try {
          await apiClient(request).patch(
            `/v1/teams/${encodeURIComponent(team.slug)}`,
            { [field]: request.payload[field] },
            { userId: getSessionUser(request).id }
          )
        } catch (error) {
          if (!(error instanceof ApiError)) {
            throw error
          }

          if (isForbidden(error)) {
            return adminRequiredView(h, team, action, 'details')
          }

          if (isNotFound(error)) {
            return teamNotFoundView(h)
          }

          throw error
        }

        setAccountNotification(request, { type: 'success', message: success })

        return h.redirect(detailsUrl(team)).code(statusCodes.seeOther)
      }
    }
  }
}

/**
 * The team's Details tab (screen 18): its name, team ID, service code and
 * what it does, with the way for admins to change the last two.
 */
export const detailsController = {
  show: {
    async handler(request, h) {
      let loaded

      try {
        loaded = await loadTeamForView(request, request.params.slug)
      } catch (error) {
        if (isNotFound(error)) {
          return teamNotFoundView(h)
        }

        throw error
      }

      const { team, isAdmin } = loaded

      return h.view('teams/details', {
        pageTitle: `${team.name} details`,
        heading: team.name,
        team,
        tabs: teamTabs(team, 'details'),
        notification: takeAccountNotification(request),
        isAdmin,
        serviceCodeChecked: Boolean(team.verified),
        serviceCodeUrl: `${detailsUrl(team)}/${CHANGES.serviceCode.path}`,
        descriptionUrl: `${detailsUrl(team)}/${CHANGES.description.path}`
      })
    }
  },
  serviceCode: changeController('serviceCode'),
  description: changeController('description')
}

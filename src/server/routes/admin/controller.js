import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from '#/server/common/helpers/api-client.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import { takeAccountNotification } from '#/server/common/helpers/session.js'
import { teamStatusTag } from '#/server/common/helpers/team-status.js'
import {
  ADMIN_AUDIT_URL,
  ADMIN_TEAMS_URL,
  adminRefusalView,
  adminTabs,
  adminTeamUrl,
  loadAdminTeam
} from './admin-page.js'
import {
  buildPagination,
  listQuery,
  loadAdminTeamList,
  queryErrors,
  STATUS_FILTERS
} from './teams-list.js'

const ADMIN_BREADCRUMB = { text: 'Admin', href: ADMIN_TEAMS_URL }

function teamsView(h, { query, result, errors }) {
  const { rows = [], page = 1, pageSize = 0, total = 0 } = result ?? {}
  const first = rows.length > 0 ? (page - 1) * pageSize + 1 : 0

  return h.view('admin/teams', {
    pageTitle: `${errors ? 'Error: ' : ''}Teams - Admin`,
    heading: 'Teams',
    breadcrumbs: [
      { text: 'Home', href: '/' },
      ADMIN_BREADCRUMB,
      { text: 'Teams' }
    ],
    tabs: adminTabs('teams'),
    values: { search: query.search ?? '', status: query.status ?? '' },
    statusItems: STATUS_FILTERS.map((item) => ({
      ...item,
      selected: item.value === (query.status ?? '')
    })),
    filtered: Boolean(query.search || query.status),
    clearUrl: ADMIN_TEAMS_URL,
    searched: result !== undefined,
    rows,
    total,
    first,
    last: first === 0 ? 0 : first + rows.length - 1,
    pagination: result ? buildPagination(result, query) : null,
    errorSummary: errors?.errorSummary ?? null,
    fieldErrors: errors?.fieldErrors ?? {}
  })
}

// Each environment the team has a file in, with that file's status and, for a
// team pending removal, the date it may be removed from.
function environmentRows(team) {
  return team.environments.map(({ environment, fileStatus, removeAfter }) => ({
    name: environmentName(environment),
    status: teamStatusTag(fileStatus),
    removeAfter: removeAfter ?? null
  }))
}

function memberRows(team, members) {
  return members.map((member) => {
    const name = member.isYou
      ? `${member.displayName} (you)`
      : member.displayName

    return {
      name,
      email: member.email,
      role: member.role === 'admin' ? 'Admin' : 'Member',
      actionUrl: `${adminTeamUrl(team)}/members/${encodeURIComponent(member._id)}/remove`,
      actionText: 'Remove',
      actionHidden: `${name} from ${team.name}`
    }
  })
}

/**
 * The Platform Admin's Teams tab: every team, found by name or status, and a
 * team's page with its status, environments and members. Each page asks the
 * backend, which decides who may see it and records a refusal.
 */
export const adminController = {
  index: {
    handler(_request, h) {
      return h.redirect(ADMIN_TEAMS_URL)
    }
  },
  teams: {
    async handler(request, h) {
      const query = listQuery(request.query)

      try {
        return teamsView(h, {
          query,
          result: await loadAdminTeamList(request, query)
        })
      } catch (error) {
        if (error instanceof ApiError && error.code === 'invalid-query') {
          return teamsView(h, { query, errors: queryErrors(query) }).code(
            statusCodes.badRequest
          )
        }

        return adminRefusalView(request, h, error)
      }
    }
  },
  team: {
    async handler(request, h) {
      let loaded

      try {
        loaded = await loadAdminTeam(request, request.params.id)
      } catch (error) {
        return adminRefusalView(request, h, error)
      }

      const { team, members } = loaded

      return h.view('admin/team', {
        pageTitle: `${team.name} - Admin`,
        heading: team.name,
        breadcrumbs: [
          { text: 'Home', href: '/' },
          ADMIN_BREADCRUMB,
          { text: 'Teams', href: ADMIN_TEAMS_URL },
          { text: team.name }
        ],
        tabs: adminTabs('teams'),
        notification: takeAccountNotification(request),
        team,
        status: teamStatusTag(team.status),
        environments: environmentRows(team),
        members: memberRows(team, members),
        addMemberUrl: `${adminTeamUrl(team)}/members/add`,
        auditLogUrl: `${ADMIN_AUDIT_URL}?team=${encodeURIComponent(team.id)}`
      })
    }
  }
}

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from '#/server/common/helpers/api-client.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import { takeAccountNotification } from '#/server/common/helpers/session.js'
import { teamStatusTag } from '#/server/common/helpers/team-status.js'
import {
  ADMIN_AUDIT_URL,
  ADMIN_TEAMS_URL,
  adminDeploymentUrl,
  adminRefusalView,
  adminTabs,
  adminTeamUrl,
  loadAdminTeam
} from './admin-page.js'
import { environmentList } from './deployment-page.js'
import { pastEnd } from './past-end.js'
import { canEnable, disabledEnvironmentsOf } from './team-lifecycle-choices.js'
import {
  buildPagination,
  listQuery,
  listUrl,
  loadAdminTeamList,
  queryErrors,
  STATUS_FILTERS
} from './teams-list.js'

const ADMIN_BREADCRUMB = { text: 'Admin', href: ADMIN_TEAMS_URL }

// What the page shows of the list before anything has been asked of the backend.
const NOT_SEARCHED = {
  searched: false,
  pastEnd: null,
  rows: [],
  total: 0,
  first: 0,
  last: 0,
  pagination: null
}

// The rows, the count over them and the way to the other pages, or a page that
// is past the last, from what the backend answered.
function listingView(result, query) {
  if (result === undefined) {
    return NOT_SEARCHED
  }

  const { rows, page, pageSize, total } = result
  const first = rows.length > 0 ? (page - 1) * pageSize + 1 : 0

  return {
    searched: true,
    pastEnd: pastEnd({
      shown: rows.length,
      page,
      pageSize,
      total,
      nouns: ['team', 'teams'],
      href: (number) => listUrl(query, number)
    }),
    rows,
    total,
    first,
    last: first === 0 ? 0 : first + rows.length - 1,
    pagination: buildPagination(result, query)
  }
}

// The search and status as the form shows them, and whether either is set.
function filterView({ search = '', status = '' }) {
  return {
    values: { search, status },
    statusItems: STATUS_FILTERS.map((item) => ({
      ...item,
      selected: item.value === status
    })),
    filtered: Boolean(search || status)
  }
}

function teamsView(h, { query, result, errors }) {
  return h.view('admin/teams', {
    pageTitle: `${errors ? 'Error: ' : ''}Teams - Admin`,
    heading: 'Teams',
    breadcrumbs: [
      { text: 'Home', href: '/' },
      ADMIN_BREADCRUMB,
      { text: 'Teams' }
    ],
    tabs: adminTabs('teams'),
    ...filterView(query),
    clearUrl: ADMIN_TEAMS_URL,
    ...listingView(result, query),
    errorSummary: errors?.errorSummary ?? null,
    fieldErrors: errors?.fieldErrors ?? {}
  })
}

// Each environment the team has a file in, with that file's status, whether
// it is disabled and, for a team pending removal, the date it may be removed
// from. A disabled environment whose file is active shows Disabled alone, so
// it never reads as both Active and Disabled; any other file status keeps its
// own tag beside Disabled.
function environmentRows(team) {
  return team.environments.map(
    ({ environment, fileStatus, removeAfter, disabled }) => {
      const locked = Boolean(disabled) && fileStatus !== 'removed'
      const replacesActive = locked && (fileStatus ?? 'active') === 'active'

      return {
        name: environmentName(environment),
        href:
          fileStatus === 'removed'
            ? null
            : adminDeploymentUrl(team.id, environment),
        status: teamStatusTag(replacesActive ? 'disabled' : fileStatus),
        statusIsDisabled: replacesActive,
        disabled: locked && !replacesActive,
        removeAfter: removeAfter ?? null
      }
    }
  )
}

const KEEPS_WORKING = 'Its credentials keep working.'

// What the page warns of while the team or any of its environments is
// disabled: the people can view but not change, and the credentials still work.
function disabledWarning(team) {
  const disabled = disabledEnvironmentsOf(team)

  if (team.status === 'disabled') {
    return `This team is disabled. Its people can view it but not change it. ${KEEPS_WORKING}`
  }

  if (disabled.length === 0) {
    return null
  }

  const one = disabled.length === 1

  return `${environmentList(disabled)} ${one ? 'is' : 'are'} disabled. The team’s people can view ${one ? 'it' : 'them'} but not change ${one ? 'it' : 'them'}. ${KEEPS_WORKING}`
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
        warning: disabledWarning(team),
        canDisable: (team.status ?? 'active') === 'active',
        canEnable: canEnable(team),
        disableUrl: `${adminTeamUrl(team)}/disable`,
        enableUrl: `${adminTeamUrl(team)}/enable`,
        environments: environmentRows(team),
        members: memberRows(team, members),
        addMemberUrl: `${adminTeamUrl(team)}/members/add`,
        auditLogUrl: `${ADMIN_AUDIT_URL}?team=${encodeURIComponent(team.id)}`
      })
    }
  }
}

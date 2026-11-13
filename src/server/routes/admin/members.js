import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import { createAddMemberController } from '../teams/add-member-controller.js'
import {
  errorOn,
  lastAdminMessage,
  memberNotFoundView,
  REMOVE_CHANGE,
  removeMemberView
} from '../teams/member-pages.js'
import { createPeopleSearchController } from '../teams/people-search-controller.js'
import { adminTeamPath } from '../teams/team-people.js'
import {
  adminDeploymentUrl,
  adminRefusalView,
  adminTeamUrl,
  loadAdminTeam
} from './admin-page.js'

// What the Platform Admin's member pages are, beside a team's own: the same
// pages and controllers, run over the admin routes by the team's id. Nothing
// here asks whether the person may: the backend does, on every call, and says
// so with a refusal (plan D3).

// Says what is true now (plan D13): the credentials stay as they are, and a
// Platform Admin cannot rotate a team's secrets, so revoking them is the way
// to stop a copy being used. The deployments are where to revoke.
const REMOVE_WARNING =
  'Removing someone does not change the team’s credentials. If this person had a copy, revoke the team’s credentials. A Platform Admin cannot rotate them.'

// A link to where the team's credentials are revoked: its deployment in the
// first environment it is still in. A team in none has no credentials to
// revoke, so there is no link.
function deploymentsLink(team) {
  const environment = team.environments?.find(
    ({ fileStatus }) => fileStatus !== 'removed'
  )?.environment

  return environment
    ? {
        text: 'View the team’s deployments',
        href: adminDeploymentUrl(team.id, environment)
      }
    : undefined
}

// The team for a page, or the page to show instead.
async function loadTeam(request, h) {
  try {
    return { loaded: await loadAdminTeam(request, request.params.id) }
  } catch (error) {
    return { page: adminRefusalView(request, h, error) }
  }
}

/** @type {import('../teams/member-pages.js').MemberScope} */
const adminMemberScope = {
  load: loadTeam,
  ref: (team) => team.id,
  pathOf: adminTeamPath,
  listUrl: adminTeamUrl,
  searchUrl: (team) => `${adminTeamUrl(team)}/members/add/people`,
  refusalView: (request, h, _team, error) => adminRefusalView(request, h, error)
}

/** A Platform Admin adds a person to any team (screen 4 of figure F5). */
export const adminAddMemberController =
  createAddMemberController(adminMemberScope)

/** The search behind that page's combobox. */
export const adminPeopleSearchController = createPeopleSearchController({
  ref: (request) => request.params.id,
  pathOf: adminTeamPath,
  messages: {
    forbidden: 'Only a Platform Admin can search for people',
    notFound: 'This team does not exist'
  }
})

function memberApiPath(team, member) {
  return `${adminTeamPath(team.id)}/members/${encodeURIComponent(member._id)}`
}

// The team and the member the page is about, or the page to show instead.
async function loadMember(request, h) {
  const { loaded, page } = await loadTeam(request, h)

  if (page) {
    return { page }
  }

  const member = loaded.members.find(
    (candidate) => candidate._id === request.params.memberId
  )

  return member
    ? { team: loaded.team, member }
    : { page: memberNotFoundView(h, loaded.team, adminTeamUrl(loaded.team)) }
}

function removeView(h, { team, member, errors }) {
  return removeMemberView(h, {
    team,
    member,
    backUrl: adminTeamUrl(team),
    cancelUrl: adminTeamUrl(team),
    warningText: REMOVE_WARNING,
    warningLink: deploymentsLink(team),
    errors
  })
}

/**
 * A Platform Admin removes a person from any team, whatever its status: a
 * confirm page, then the removal. A team always keeps an admin: the backend
 * refuses the removal that would leave it with none.
 */
export const adminRemoveMemberController = {
  get: {
    async handler(request, h) {
      const { team, member, page } = await loadMember(request, h)

      return page ?? removeView(h, { team, member })
    }
  },
  post: {
    async handler(request, h) {
      const { team, member, page } = await loadMember(request, h)

      if (page) {
        return page
      }

      try {
        await apiClient(request).del(memberApiPath(team, member))
      } catch (error) {
        return removalRefusal(request, h, { team, member, error })
      }

      setAccountNotification(request, {
        type: 'success',
        message: member.isYou
          ? `You have been removed from ${team.name}.`
          : `${member.displayName} has been removed from ${team.name}.`
      })

      return h.redirect(adminTeamUrl(team)).code(statusCodes.seeOther)
    }
  }
}

// What a removal the backend refused says: the last admin stays (the person
// is told what to do), a member already gone is not found, and anything else
// is for the shared refusals.
function removalRefusal(request, h, { team, member, error }) {
  if (error instanceof ApiError && error.code === 'last-admin') {
    return removeView(h, {
      team,
      member,
      errors: errorOn('remove-member', lastAdminMessage(member, REMOVE_CHANGE))
    }).code(statusCodes.conflict)
  }

  if (error instanceof ApiError && error.code === 'member-not-found') {
    return memberNotFoundView(h, team, adminTeamUrl(team))
  }

  return adminRefusalView(request, h, error)
}

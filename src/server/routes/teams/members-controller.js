import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import {
  setAccountNotification,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import {
  errorOn,
  joiErrors,
  loadAdminTeam,
  memberNotFoundView,
  membersUrl,
  noErrors,
  refusalView
} from './member-pages.js'
import { memberRoleSchema } from './members-schemas.js'
import {
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamTabs
} from './team-view.js'

function roleText(role) {
  return role === 'admin' ? 'Admin' : 'Member'
}

// The member a page is about: `me` is the signed-in person.
async function loadAdminMember(request, h, action) {
  const result = await loadAdminTeam(request, h, action)

  if (result.page) {
    return result
  }

  const { memberId } = request.params
  const member = result.loaded.members.find((candidate) =>
    memberId === 'me' ? candidate.isYou : candidate._id === memberId
  )

  if (!member) {
    return { page: memberNotFoundView(h, result.loaded.team) }
  }

  return { ...result, member }
}

function memberUrl(request, suffix) {
  const { slug, memberId } = request.params

  return `${membersUrl({ slug })}/${encodeURIComponent(memberId)}/${suffix}`
}

function memberApiPath(team, member) {
  return `/v1/teams/${encodeURIComponent(team.slug)}/members/${encodeURIComponent(member._id)}`
}

function roleView(h, request, { team, member, role, errors = noErrors() }) {
  const heading = member.isYou
    ? 'Change your role'
    : `Change ${member.displayName}’s role`

  return h.view('teams/member-role', {
    pageTitle: `${errors.errorSummary ? 'Error: ' : ''}${heading}`,
    heading,
    team,
    backUrl: membersUrl(team),
    role,
    removeUrl: memberUrl(request, 'remove'),
    removeText: member.isYou
      ? 'Remove yourself from this team'
      : `Remove ${member.displayName} from this team`,
    ...errors
  })
}

function removeView(h, request, { team, member, errors = noErrors() }) {
  const heading = `Remove ${member.displayName} from ${team.name}?`

  return h.view('teams/remove-member', {
    pageTitle: `${errors.errorSummary ? 'Error: ' : ''}${heading}`,
    heading,
    team,
    backUrl: memberUrl(request, 'role'),
    cancelUrl: membersUrl(team),
    buttonText: `Remove ${member.displayName}`,
    ...errors
  })
}

function lastAdminMessage(member, change) {
  return member.isYou
    ? `You are the only admin. Add another admin before you ${change.you}.`
    : `A team must keep at least one admin. Add another admin before you ${change.other(member.displayName)}.`
}

const ROLE_CHANGE = {
  you: 'change your role',
  other: (name) => `change ${name}’s role`
}

const REMOVE_CHANGE = {
  you: 'remove yourself from this team',
  other: (name) => `remove ${name} from this team`
}

function memberRow(member, { team, isAdmin }) {
  return {
    name: member.isYou ? `${member.displayName} (you)` : member.displayName,
    email: member.email,
    role: roleText(member.role),
    changeUrl: isAdmin
      ? `${membersUrl(team)}/${member.isYou ? 'me' : encodeURIComponent(member._id)}/role`
      : null
  }
}

/**
 * The team's Members tab: who is in it, and for admins the way to add
 * people and to change a person's role or remove them (screen 13).
 */
export const membersController = {
  list: {
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

      const { team, isAdmin, members } = loaded

      return h.view('teams/members', {
        pageTitle: `${team.name} members`,
        heading: team.name,
        team,
        tabs: teamTabs(team, 'members'),
        notification: takeAccountNotification(request),
        isAdmin,
        addMemberUrl: `${membersUrl(team)}/add`,
        members: members.map((member) => memberRow(member, { team, isAdmin }))
      })
    }
  }
}

/**
 * An admin changes a person's role, or goes on to remove them (screen 15).
 * A team always keeps an admin: the backend refuses the change that would
 * leave it with none, and the page says what to do instead.
 */
export const memberRoleController = {
  get: {
    async handler(request, h) {
      const { loaded, member, page } = await loadAdminMember(
        request,
        h,
        'change roles'
      )

      return (
        page ??
        roleView(h, request, {
          team: loaded.team,
          member,
          role: member.role
        })
      )
    }
  },
  post: {
    options: {
      validate: {
        payload: memberRoleSchema,
        async failAction(request, h, error) {
          const { loaded, member, page } = await loadAdminMember(
            request,
            h,
            'change roles'
          )

          return (
            page ??
            roleView(h, request, {
              team: loaded.team,
              member,
              role: member.role,
              errors: joiErrors(error)
            }).code(statusCodes.badRequest)
          ).takeover()
        }
      }
    },
    async handler(request, h) {
      const { loaded, member, page } = await loadAdminMember(
        request,
        h,
        'change roles'
      )

      if (page) {
        return page
      }

      const { team } = loaded
      const { role } = request.payload

      try {
        await apiClient(request).patch(memberApiPath(team, member), { role })
      } catch (error) {
        if (error instanceof ApiError && error.code === 'last-admin') {
          return roleView(h, request, {
            team,
            member,
            role,
            errors: errorOn('role', lastAdminMessage(member, ROLE_CHANGE))
          }).code(statusCodes.conflict)
        }

        return refusalView(h, team, error, 'change roles')
      }

      const now = role === 'admin' ? 'an admin' : 'a member'

      setAccountNotification(request, {
        type: 'success',
        message: member.isYou
          ? `You are now ${now}.`
          : `${member.displayName} is now ${now}.`
      })

      return h.redirect(membersUrl(team)).code(statusCodes.seeOther)
    }
  }
}

/**
 * An admin removes a person from the team, or someone removes themselves:
 * a confirm page that says the client secret is not changed (screen 15).
 */
export const removeMemberController = {
  get: {
    async handler(request, h) {
      const { loaded, member, page } = await loadAdminMember(
        request,
        h,
        'remove people'
      )

      return page ?? removeView(h, request, { team: loaded.team, member })
    }
  },
  post: {
    async handler(request, h) {
      const { loaded, member, page } = await loadAdminMember(
        request,
        h,
        'remove people'
      )

      if (page) {
        return page
      }

      const { team } = loaded

      try {
        await apiClient(request).del(memberApiPath(team, member))
      } catch (error) {
        if (error instanceof ApiError && error.code === 'last-admin') {
          return removeView(h, request, {
            team,
            member,
            errors: errorOn(
              'remove-member',
              lastAdminMessage(member, REMOVE_CHANGE)
            )
          }).code(statusCodes.conflict)
        }

        return refusalView(h, team, error, 'remove people')
      }

      setAccountNotification(request, {
        type: 'success',
        message: member.isYou
          ? `You have been removed from ${team.name}.`
          : `${member.displayName} has been removed from ${team.name}.`
      })

      // Someone who has removed themselves can no longer see the team.
      return h
        .redirect(member.isYou ? '/teams' : membersUrl(team))
        .code(statusCodes.seeOther)
    }
  }
}

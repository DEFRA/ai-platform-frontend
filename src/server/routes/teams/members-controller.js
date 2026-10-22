import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient, ApiError } from '#/server/common/helpers/api-client.js'
import { requireSignIn } from '#/server/common/helpers/require-sign-in.js'
import {
  getSessionUser,
  setAccountNotification,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  isForbidden,
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamTabs,
  teamUrl
} from './team-view.js'

const MAX_EMAIL_LENGTH = 254

const roleField = Joi.string().valid('admin', 'user').messages({
  'any.only': 'Select a role',
  'any.required': 'Select a role'
})

const memberRoleSchema = Joi.object({ role: roleField.required() })

const addMemberSchema = Joi.object({
  email: Joi.string()
    .trim()
    .email()
    .max(MAX_EMAIL_LENGTH)
    .required()
    .messages({
      'string.empty': 'Enter an email address',
      'any.required': 'Enter an email address',
      'string.email':
        'Enter an email address in the correct format, like name@defra.gov.uk',
      'string.max': `Email address must be ${MAX_EMAIL_LENGTH} characters or fewer`
    }),
  role: roleField.default('user')
})

function membersUrl(team) {
  return `${teamUrl(team)}/members`
}

// What a person is called in a heading or a banner: their name once they
// have signed in, otherwise the address they were invited by.
function memberName(member) {
  return member.displayName ?? member.email ?? 'this person'
}

function roleText(role) {
  return role === 'admin' ? 'Admin' : 'Member'
}

function adminRequiredView(h, team, action) {
  return h
    .view('error/index', {
      pageTitle: 'Admins only',
      heading: 'Only a team admin can do that',
      message: `Only an admin of ${team.name} can ${action}.`,
      actionHref: membersUrl(team),
      actionText: 'Back to the members'
    })
    .code(statusCodes.forbidden)
}

function memberNotFoundView(h, team) {
  return h
    .view('error/index', {
      pageTitle: 'Member not found',
      heading: 'Member not found',
      message: `This person is not a member of ${team.name}, or has already been removed.`,
      actionHref: membersUrl(team),
      actionText: 'Back to the members'
    })
    .code(statusCodes.notFound)
}

// The team for a page only its admins may use, or the page to show instead:
// a team that is not theirs is not found; a member is told it is for admins.
async function loadAdminTeam(request, h, action) {
  // A failed validation runs before the global sign-in gate, so a signed-out
  // person (with a still-valid CSRF token) is sent to sign in here.
  const signIn = requireSignIn(request, h)

  if (signIn !== h.continue) {
    return { page: signIn }
  }

  let loaded

  try {
    loaded = await loadTeamForView(request, request.params.slug)
  } catch (error) {
    if (isNotFound(error)) {
      return { page: teamNotFoundView(h) }
    }

    throw error
  }

  if (!loaded.isAdmin) {
    return { page: adminRequiredView(h, loaded.team, action) }
  }

  return { loaded }
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

// A change the backend refused for a reason the person cannot fix on the
// page (they are not an admin, or it is not there): the page to show instead.
// Anything else is a fault, so it is thrown.
function refusalView(h, team, error, action) {
  if (!(error instanceof ApiError)) {
    throw error
  }

  if (isForbidden(error)) {
    return adminRequiredView(h, team, action)
  }

  if (isNotFound(error)) {
    return memberNotFoundView(h, team)
  }

  throw error
}

function errorOn(field, text) {
  return {
    errorSummary: [{ text, href: `#${field}` }],
    fieldErrors: { [field]: { text } }
  }
}

function noErrors() {
  return { errorSummary: null, fieldErrors: {} }
}

function joiErrors(error) {
  return {
    errorSummary: buildErrorSummary(error),
    fieldErrors: buildFieldErrors(error)
  }
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
    : `Change ${memberName(member)}’s role`

  return h.view('teams/member-role', {
    pageTitle: `${errors.errorSummary ? 'Error: ' : ''}${heading}`,
    heading,
    team,
    backUrl: membersUrl(team),
    role,
    removeUrl: memberUrl(request, 'remove'),
    removeText: member.isYou
      ? 'Remove yourself from this team'
      : `Remove ${memberName(member)} from this team`,
    ...errors
  })
}

function removeView(h, request, { team, member, errors = noErrors() }) {
  const heading = `Remove ${memberName(member)} from ${team.name}?`

  return h.view('teams/remove-member', {
    pageTitle: `${errors.errorSummary ? 'Error: ' : ''}${heading}`,
    heading,
    team,
    backUrl: memberUrl(request, 'role'),
    cancelUrl: membersUrl(team),
    buttonText: `Remove ${memberName(member)}`,
    ...errors
  })
}

function addMemberView(h, { team, values, errors = noErrors() }) {
  return h.view('teams/add-member', {
    pageTitle: `${errors.errorSummary ? 'Error: ' : ''}Add a member`,
    heading: 'Add a member',
    team,
    backUrl: membersUrl(team),
    values,
    ...errors
  })
}

function lastAdminMessage(member, change) {
  return member.isYou
    ? `You are the only admin. Add another admin before you ${change.you}.`
    : `A team must keep at least one admin. Add another admin before you ${change.other(memberName(member))}.`
}

const ROLE_CHANGE = {
  you: 'change your role',
  other: (name) => `change ${name}’s role`
}

const REMOVE_CHANGE = {
  you: 'remove yourself from this team',
  other: (name) => `remove ${name} from this team`
}

function memberRow(member, { team, isAdmin, sessionUser }) {
  const name =
    member.displayName ?? (member.isYou ? sessionUser.displayName : null)

  return {
    name: member.isYou ? `${name ?? 'You'} (you)` : name,
    notSignedIn: !name,
    email: member.email ?? 'Team creator',
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
      const sessionUser = getSessionUser(request)

      return h.view('teams/members', {
        pageTitle: `${team.name} members`,
        heading: team.name,
        team,
        tabs: teamTabs(team, 'members'),
        notification: takeAccountNotification(request),
        isAdmin,
        addMemberUrl: `${membersUrl(team)}/add`,
        members: members.map((member) =>
          memberRow(member, { team, isAdmin, sessionUser })
        )
      })
    }
  }
}

/**
 * An admin adds someone by email, with a role (screen 14).
 */
export const addMemberController = {
  get: {
    async handler(request, h) {
      const { loaded, page } = await loadAdminTeam(request, h, 'add people')

      return (
        page ??
        addMemberView(h, {
          team: loaded.team,
          values: { email: '', role: 'user' }
        })
      )
    }
  },
  post: {
    options: {
      validate: {
        payload: addMemberSchema,
        async failAction(request, h, error) {
          const { loaded, page } = await loadAdminTeam(request, h, 'add people')
          const { email = '', role = 'user' } = request.payload ?? {}

          return (
            page ??
            addMemberView(h, {
              team: loaded.team,
              values: { email, role },
              errors: joiErrors(error)
            }).code(statusCodes.badRequest)
          ).takeover()
        }
      }
    },
    async handler(request, h) {
      const { loaded, page } = await loadAdminTeam(request, h, 'add people')

      if (page) {
        return page
      }

      const { team } = loaded
      const { email, role } = request.payload

      try {
        await apiClient(request).post(
          `/v1/teams/${encodeURIComponent(team.slug)}/members`,
          { email, role },
          {
            userId: getSessionUser(request).id,
            idempotencyKey: randomUUID()
          }
        )
      } catch (error) {
        if (error instanceof ApiError && error.code === 'member-exists') {
          return addMemberView(h, {
            team,
            values: { email, role },
            errors: errorOn(
              'email',
              'This person is already a member of this team'
            )
          }).code(statusCodes.conflict)
        }

        return refusalView(h, team, error, 'add people')
      }

      setAccountNotification(request, {
        type: 'success',
        heading: `${email} has been added`,
        message: 'They will see the team when they next sign in.'
      })

      return h.redirect(membersUrl(team)).code(statusCodes.seeOther)
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
        await apiClient(request).patch(
          memberApiPath(team, member),
          { role },
          { userId: getSessionUser(request).id }
        )
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
          : `${memberName(member)} is now ${now}.`
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
        await apiClient(request).del(memberApiPath(team, member), {
          userId: getSessionUser(request).id
        })
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
          : `${memberName(member)} has been removed from ${team.name}.`
      })

      // Someone who has removed themselves can no longer see the team.
      return h
        .redirect(member.isYou ? '/teams' : membersUrl(team))
        .code(statusCodes.seeOther)
    }
  }
}

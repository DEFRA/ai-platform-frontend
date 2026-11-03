import { randomUUID } from 'node:crypto'
import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import {
  clearAddMemberKey,
  getAddMemberKey,
  getSessionUser,
  setAccountNotification,
  setAddMemberKey,
  takeAccountNotification
} from '#/server/common/helpers/session.js'
import {
  buildErrorSummary,
  buildFieldErrors
} from '#/server/common/helpers/govuk-errors.js'
import {
  adminRequiredView as adminRequired,
  loadAdminTeam as loadAdmin
} from './admin-team.js'
import {
  addTeamMember,
  MAX_SEARCH_LENGTH,
  MIN_SEARCH_LENGTH,
  personProblem,
  searchTeamPeople
} from './team-people.js'
import {
  isForbidden,
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamTabs,
  teamUrl
} from './team-view.js'

const roleField = Joi.string().valid('admin', 'user').messages({
  'any.only': 'Select a role',
  'any.required': 'Select a role'
})

const memberRoleSchema = Joi.object({ role: roleField.required() })

const enterSearch = 'Enter a name or email address to search for'
const selectPerson = 'Select a person'

function searchField() {
  return Joi.string()
    .trim()
    .max(MAX_SEARCH_LENGTH)
    .messages({
      'string.base': enterSearch,
      'string.empty': enterSearch,
      'any.required': enterSearch,
      'string.min': `Enter at least ${MIN_SEARCH_LENGTH} characters of their name or email address`,
      'string.max': `Name or email address must be ${MAX_SEARCH_LENGTH} characters or fewer`
    })
}

// One form, two buttons: `search` finds people and never adds anyone (it is
// also what a missing action means), `add` adds the person chosen, with a
// role that has to be chosen.
const addMemberSchema = Joi.object({
  action: Joi.string().valid('search', 'add').default('search'),
  search: Joi.when('action', {
    is: 'add',
    then: searchField().allow('').default(''),
    otherwise: searchField().min(MIN_SEARCH_LENGTH).required()
  }),
  oid: Joi.when('action', {
    is: 'add',
    then: Joi.string().guid().required().messages({
      'string.base': selectPerson,
      'string.empty': selectPerson,
      'string.guid': selectPerson,
      'any.required': selectPerson
    }),
    otherwise: Joi.any().strip()
  }),
  role: Joi.when('action', {
    is: 'add',
    then: roleField.required(),
    otherwise: roleField.default('user')
  })
})

function membersUrl(team) {
  return `${teamUrl(team)}/members`
}

function roleText(role) {
  return role === 'admin' ? 'Admin' : 'Member'
}

function adminRequiredView(h, team, action) {
  return adminRequired(h, team, action, 'members')
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

function loadAdminTeam(request, h, action) {
  return loadAdmin(request, h, action, 'members')
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

// A person the admin can choose, as the select list shows them.
function personItems(people, chosenOid) {
  return [
    { value: '', text: selectPerson },
    ...people.map(({ oid, displayName, email }) => ({
      value: oid,
      text: `${displayName} - ${email}`,
      selected: oid === chosenOid
    }))
  ]
}

// The error for "no person" belongs on the select list when there is one to
// choose from, and otherwise on the text field, which is where the person
// is looked for.
function placeErrors(errors, hasList) {
  if (hasList || !errors.fieldErrors.oid) {
    return errors
  }

  const { oid, ...fieldErrors } = errors.fieldErrors

  return {
    errorSummary: errors.errorSummary.map((item) =>
      item.href === '#oid' ? { ...item, href: '#search' } : item
    ),
    fieldErrors: { ...fieldErrors, search: fieldErrors.search ?? oid }
  }
}

// `people` is the matches to choose from, or null when nobody has searched
// (or the search could not be made again). `searched` is for a page that is
// the answer to a search: only then does an empty list mean "no one found".
function addMemberView(
  h,
  { team, values, people = null, searched = false, errors = noErrors() }
) {
  const hasList = Boolean(people?.length)
  const placed = placeErrors(errors, hasList)

  return h.view('teams/add-member', {
    pageTitle: `${placed.errorSummary ? 'Error: ' : ''}Add a member`,
    heading: 'Add a member',
    team,
    backUrl: membersUrl(team),
    searchUrl: `${membersUrl(team)}/add/people`,
    values,
    personItems: hasList ? personItems(people, values.oid) : null,
    personCount: people?.length,
    noMatches: searched && people?.length === 0,
    ...placed
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

function text(value) {
  return typeof value === 'string' ? value : ''
}

// What the form shows again: what was sent (which may not have passed
// validation), or, with nothing sent, the empty form with Member chosen.
function submittedValues(payload) {
  return {
    action: payload?.action,
    search: text(payload?.search),
    oid: text(payload?.oid),
    role: payload ? text(payload.role) : 'user'
  }
}

// The matches for a page that goes back to the admin after an add that was
// not made, so that the person chosen is still there to choose. It is no more
// than a convenience: with no text to search for, or a directory that does
// not answer, the page shows the error without the list.
async function matchesAgain(request, team, search) {
  const query = search.trim()

  if (query.length < MIN_SEARCH_LENGTH || query.length > MAX_SEARCH_LENGTH) {
    return null
  }

  try {
    return await searchTeamPeople(request, team.slug, query)
  } catch (error) {
    if (error instanceof ApiError) {
      return null
    }

    throw error
  }
}

async function searchPeople(request, h, team, values) {
  const shown = { ...values, oid: '' }

  try {
    const people = await searchTeamPeople(request, team.slug, values.search)

    return addMemberView(h, { team, values: shown, people, searched: true })
  } catch (error) {
    const problem = personProblem(error)

    if (!problem) {
      return refusalView(h, team, error, 'add people')
    }

    return addMemberView(h, {
      team,
      values: shown,
      errors: errorOn('search', problem.text)
    }).code(problem.statusCode)
  }
}

// The key for adding this person with this role: the same for a retry of the
// same choice, so the backend adds once, and new for any other, so it cannot
// answer a different choice with an earlier one. It is kept in the session.
function keyForAdd(request, team, { oid, role }) {
  const choice = `${team.slug}|${oid}|${role}`
  const saved = getAddMemberKey(request)

  if (saved?.choice === choice) {
    return saved.key
  }

  const key = randomUUID()

  setAddMemberKey(request, { choice, key })

  return key
}

async function addPerson(request, h, team, values) {
  const { oid, role } = values
  let member

  try {
    member = await addTeamMember(
      request,
      team.slug,
      { oid, role },
      keyForAdd(request, team, values)
    )
  } catch (error) {
    const problem = personProblem(error)

    if (!problem) {
      return refusalView(h, team, error, 'add people')
    }

    return addMemberView(h, {
      team,
      values,
      people: await matchesAgain(request, team, values.search),
      errors: errorOn('oid', problem.text)
    }).code(problem.statusCode)
  }

  clearAddMemberKey(request)

  setAccountNotification(request, {
    type: 'success',
    heading: `${member.displayName ?? 'This person'} has been added`,
    message: 'They can use the team straight away.'
  })

  return h.redirect(membersUrl(team)).code(statusCodes.seeOther)
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
 * An admin adds a person from the directory, with a role (screen 14). The
 * page searches as the admin types when it has script; without script, the
 * Search button posts the text and the page comes back with the matches.
 */
export const addMemberController = {
  get: {
    async handler(request, h) {
      const { loaded, page } = await loadAdminTeam(request, h, 'add people')

      return (
        page ??
        addMemberView(h, {
          team: loaded.team,
          values: submittedValues()
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

          if (page) {
            return page.takeover()
          }

          const values = submittedValues(request.payload)
          const people =
            values.action === 'add'
              ? await matchesAgain(request, loaded.team, values.search)
              : null

          return addMemberView(h, {
            team: loaded.team,
            values,
            people,
            errors: joiErrors(error)
          })
            .code(statusCodes.badRequest)
            .takeover()
        }
      }
    },
    async handler(request, h) {
      const { loaded, page } = await loadAdminTeam(request, h, 'add people')

      if (page) {
        return page
      }

      const { action, ...values } = request.payload

      return action === 'add'
        ? addPerson(request, h, loaded.team, values)
        : searchPeople(request, h, loaded.team, values)
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
          : `${member.displayName} has been removed from ${team.name}.`
      })

      // Someone who has removed themselves can no longer see the team.
      return h
        .redirect(member.isYou ? '/teams' : membersUrl(team))
        .code(statusCodes.seeOther)
    }
  }
}

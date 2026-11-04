import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from '#/server/common/helpers/api-client.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import {
  carryAddKey,
  issueAddKey,
  keyForAdd,
  nextAddKeyGeneration,
  voidAddKey
} from './add-member-keys.js'
import {
  errorOn,
  joiErrors,
  loadAdminTeam,
  membersUrl,
  noErrors,
  refusalView
} from './member-pages.js'
import { addMemberSchema, isGuid, selectPerson } from './members-schemas.js'
import {
  addTeamMember,
  MAX_SEARCH_LENGTH,
  MIN_SEARCH_LENGTH,
  personProblem,
  searchTeamPeople
} from './team-people.js'

// What an admin is doing, as the page says it when they may not.
const ADD_PEOPLE = 'add people'

// A person the admin can choose, as the select list shows them. A person the
// matches no longer hold has only the label the field showed.
function personItems(people, chosenOid) {
  return [
    { value: '', text: selectPerson },
    ...people.map(({ oid, displayName, email, label }) => ({
      value: oid,
      text: label ?? `${displayName} - ${email}`,
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
// `idempotencyKey` is the key of the add this form is for (see
// add-member-keys.js), carried in the form.
function addMemberView(
  h,
  {
    team,
    values,
    idempotencyKey,
    people = null,
    searched = false,
    errors = noErrors()
  }
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
    idempotencyKey,
    personItems: hasList ? personItems(people, values.oid) : null,
    personCount: people?.length,
    noMatches: searched && people?.length === 0,
    ...placed
  })
}

function asText(value) {
  return typeof value === 'string' ? value : ''
}

// What the form shows again: what was sent (which may not have passed
// validation), or, with nothing sent, the empty form with Member chosen.
// `query` is sent only by the form with script.
function submittedValues(payload) {
  return {
    action: payload?.action,
    search: asText(payload?.search),
    query: typeof payload?.query === 'string' ? payload.query : undefined,
    oid: asText(payload?.oid),
    role: payload ? asText(payload.role) : 'user'
  }
}

async function findAgain(request, team, search) {
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

// The matches for a page that goes back to the admin after an add that was
// not made, so that the person chosen is still there to choose. It is no more
// than a convenience: with no text to search for, or a directory that does
// not answer, the page shows the error without the list.
//
// With script, the field holds the person's label and `query` what was typed,
// which is what is searched for. If the matches do not hold the person chosen
// (or there are none), the person is kept, as the label the field showed.
async function matchesAgain(request, team, values) {
  const { oid, search, query } = values
  const scripted = typeof query === 'string'
  const people = await findAgain(request, team, scripted ? query : search)

  if (
    !scripted ||
    !isGuid(oid) ||
    !search ||
    people?.some((person) => person.oid === oid)
  ) {
    return people
  }

  return [{ oid, label: search }, ...(people ?? [])]
}

async function searchPeople(request, h, team, values) {
  const shown = { ...values, oid: '' }
  const idempotencyKey = carryAddKey(request, team.slug, values.idempotencyKey)

  try {
    const people = await searchTeamPeople(request, team.slug, values.search)

    return addMemberView(h, {
      team,
      values: shown,
      idempotencyKey,
      people,
      searched: true
    })
  } catch (error) {
    const problem = personProblem(error)

    if (!problem) {
      return refusalView(h, team, error, ADD_PEOPLE)
    }

    return addMemberView(h, {
      team,
      values: shown,
      idempotencyKey,
      errors: errorOn('search', problem.text)
    }).code(problem.statusCode)
  }
}

async function addPerson(request, h, team, values) {
  const { oid, role } = values
  let idempotencyKey = keyForAdd(
    request,
    team.slug,
    { oid, role },
    values.idempotencyKey
  )
  let member

  try {
    member = await addTeamMember(
      request,
      team.slug,
      { oid, role },
      idempotencyKey
    )
  } catch (error) {
    const problem = personProblem(error)

    if (!problem) {
      return refusalView(h, team, error, ADD_PEOPLE)
    }

    // The backend knows this key for another choice: the next try is a new
    // add, with a new key (the form's, and the one made without a form key).
    // Any other refusal is tried again with this key.
    if (error.code === 'idempotency-key-reused') {
      voidAddKey(request, idempotencyKey)
      nextAddKeyGeneration(request)
      idempotencyKey = issueAddKey(request, team.slug)
    }

    return addMemberView(h, {
      team,
      values,
      idempotencyKey,
      people: await matchesAgain(request, team, values),
      errors: errorOn('oid', problem.text)
    }).code(problem.statusCode)
  }

  // The key is kept: the same form sent again (a double click, the back
  // button) is the same add, and the backend answers it as it did the first.
  // A later add of the same person and role without a form key is a new one.
  nextAddKeyGeneration(request)
  setAccountNotification(request, {
    type: 'success',
    heading: `${member.displayName ?? 'This person'} has been added`,
    message: 'They can use the team straight away.'
  })

  return h.redirect(membersUrl(team)).code(statusCodes.seeOther)
}

/**
 * An admin adds a person from the directory, with a role (screen 14). The
 * page searches as the admin types when it has script; without script, the
 * Search button posts the text and the page comes back with the matches.
 */
export const addMemberController = {
  get: {
    async handler(request, h) {
      const { loaded, page } = await loadAdminTeam(request, h, ADD_PEOPLE)

      return (
        page ??
        addMemberView(h, {
          team: loaded.team,
          values: submittedValues(),
          idempotencyKey: issueAddKey(request, loaded.team.slug)
        })
      )
    }
  },
  post: {
    options: {
      validate: {
        payload: addMemberSchema,
        async failAction(request, h, error) {
          const { loaded, page } = await loadAdminTeam(request, h, ADD_PEOPLE)

          if (page) {
            return page.takeover()
          }

          const values = submittedValues(request.payload)
          const people =
            values.action === 'add'
              ? await matchesAgain(request, loaded.team, values)
              : null

          return addMemberView(h, {
            team: loaded.team,
            values,
            idempotencyKey: carryAddKey(
              request,
              loaded.team.slug,
              request.payload?.idempotencyKey
            ),
            people,
            errors: joiErrors(error)
          })
            .code(statusCodes.badRequest)
            .takeover()
        }
      }
    },
    async handler(request, h) {
      const { loaded, page } = await loadAdminTeam(request, h, ADD_PEOPLE)

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

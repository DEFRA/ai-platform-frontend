import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import {
  ADMIN_TEAMS_URL,
  adminRefusalView,
  adminTabs,
  adminTeamUrl,
  isCallFailure,
  loadAdminTeam
} from './admin-page.js'
import { readEnvironments } from './credential-actions.js'
import {
  carryFormKey,
  issueFormKey,
  teamDisableKey
} from './credential-keys.js'
import { readReason, REASON_CODES } from './credential-reason.js'
import { environmentList } from './deployment-page.js'
import {
  canEnable,
  disabledEnvironmentsOf,
  enableMessage,
  knownEnvironments,
  offeredToDisable,
  resolveTeamEnvironments,
  teamEnvironmentChoices
} from './team-lifecycle-choices.js'

// The pages that disable a team (which environments to disable as well, a
// reason, then one call to the backend) and enable it (which disabled
// environments to unlock, then one call). The call is for the whole team, so
// the backend does it once or not at all and a repeat with the same key is the
// same request. Nothing here decides who may: every page asks the backend for
// the team first, and the backend refuses anyone who is not a Platform Admin.

const TEAMS_API = '/v1/admin/teams'
const ENVIRONMENTS_ANCHOR = '#environments'
const REASON_ANCHOR = '#reason'
const NOT_OFFERED_TEXT = 'Choose environments from the list'

const KEEPS_WORKING =
  'Its credentials keep working. To stop them, disable or revoke credentials on the Deployments tab.'
const BACK_TO_TEAM = 'Back to the team'

function disableUrl(team, suffix = '') {
  return `${adminTeamUrl(team)}/disable${suffix}`
}

function enableUrl(team) {
  return `${adminTeamUrl(team)}/enable`
}

function disabledUrl(team) {
  return `${adminTeamUrl(team)}/disabled`
}

// The address of a page for some environments, named in the address and
// checked again by the page.
function withEnvironments(url, environments) {
  return environments.length > 0
    ? `${url}?environments=${environments.map(encodeURIComponent).join(',')}`
    : url
}

function pageView(h, template, team, heading, context) {
  return h.view(template, {
    pageTitle: `${context.errorSummary ? 'Error: ' : ''}${context.titleText ?? heading} - ${team.name} - Admin`,
    heading,
    caption: team.name,
    breadcrumbs: [
      { text: 'Home', href: '/' },
      { text: 'Admin', href: ADMIN_TEAMS_URL },
      { text: 'Teams', href: ADMIN_TEAMS_URL },
      { text: team.name, href: adminTeamUrl(team) },
      { text: context.crumb ?? heading }
    ],
    tabs: adminTabs('teams'),
    deploymentUrl: adminTeamUrl(team),
    backText: BACK_TO_TEAM,
    errorSummary: null,
    ...context
  })
}

function environmentNotFoundView(h, team) {
  return h
    .view('error/index', {
      pageTitle: 'Environment not found',
      heading: 'Environment not found',
      message: `${team.name} has no such environment.`,
      actionHref: adminTeamUrl(team),
      actionText: BACK_TO_TEAM
    })
    .code(statusCodes.notFound)
}

// "Which environments?", for Disable (optional, may be none) and Enable.
function chooseView(h, team, copy, { ticked, problem }) {
  const error = problem ? { text: NOT_OFFERED_TEXT } : null

  return pageView(h, 'admin/credential-environments', team, copy.heading, {
    items: teamEnvironmentChoices(copy.offered, ticked),
    hintText: copy.hintText,
    noItemsText: copy.noItemsText,
    buttonText: copy.buttonText,
    buttonClasses: copy.buttonClasses,
    backUrl: adminTeamUrl(team),
    nothingToDo: copy.nothingToDo ?? false,
    nothingText: copy.nothingText,
    errorSummary: error
      ? [{ text: error.text, href: ENVIRONMENTS_ANCHOR }]
      : null,
    fieldError: error
  }).code(problem ? statusCodes.badRequest : statusCodes.ok)
}

function disableChoice(team) {
  return {
    heading: 'Disable team',
    offered: offeredToDisable(team),
    hintText:
      'Optional. Environments you do not tick stay usable. You can choose none.',
    noItemsText:
      disabledEnvironmentsOf(team).length > 0
        ? 'Every environment is already disabled. You can still disable the team.'
        : 'There are no models to disable. You can still disable the team.',
    buttonText: 'Continue',
    buttonClasses: ''
  }
}

function enableChoice(team) {
  return {
    heading: 'Enable team',
    offered: disabledEnvironmentsOf(team),
    hintText:
      'The team is enabled whatever you choose. Environments you do not tick stay disabled.',
    noItemsText:
      'No environment is disabled. Enabling the team lets its people change it again.',
    buttonText: 'Enable team',
    buttonClasses: '',
    nothingToDo: !canEnable(team),
    nothingText: 'This team is not disabled, and none of its environments are.'
  }
}

// The reason page, which is also the confirm step. The text is shown as it was
// typed (escaped by the template).
function reasonView(h, team, form) {
  const where =
    form.environments.length > 0
      ? `, and cannot change anything in ${environmentList(form.environments)}`
      : ''
  const error = form.error ? { text: form.error } : null

  return pageView(h, 'admin/credential-reason', team, 'Disable team', {
    effect: `People in ${team.name} can view it but not change it${where}. The team is not told why.`,
    note: KEEPS_WORKING,
    buttonText: 'Disable team',
    buttonClasses: 'govuk-button--secondary',
    backUrl: withEnvironments(disableUrl(team), form.environments),
    formKey: form.formKey,
    reasonText: form.text ?? '',
    errorSummary: error ? [{ text: error.text, href: REASON_ANCHOR }] : null,
    fieldError: error
  }).code(error ? statusCodes.badRequest : statusCodes.ok)
}

function doneView(h, team, environments) {
  return pageView(h, 'admin/credential-done', team, 'Team disabled', {
    titleText: 'Team disabled',
    environmentsText:
      environments.length > 0
        ? `${environmentList(environments)} also disabled`
        : '',
    effect: KEEPS_WORKING
  })
}

function failedView(h, team, { heading, retryUrl }) {
  return pageView(h, 'admin/credential-failed', team, heading, {
    titleText: heading,
    doneText: null,
    retryUrl
  }).code(statusCodes.badGateway)
}

// The environments a page is for, or the page to show instead: the 404 page
// for one the team does not have, the choice again for one not offered.
function environmentsOrPage(h, team, copy, requested) {
  const resolved = resolveTeamEnvironments(requested, {
    known: knownEnvironments(team),
    offered: copy.offered
  })

  if (resolved.problem === 'unknown') {
    return { page: environmentNotFoundView(h, team) }
  }

  if (resolved.problem) {
    return {
      page: chooseView(h, team, copy, { ticked: requested, problem: true })
    }
  }

  return { environments: resolved.environments }
}

async function loadTeam(request) {
  const { team } = await loadAdminTeam(request, request.params.id)

  return team
}

// Each page is asked for the team first, which is the check; whatever the
// backend refuses is shown as the Admin area shows it.
function guarded(handler) {
  return async (request, h) => {
    try {
      return await handler(request, h)
    } catch (error) {
      return adminRefusalView(request, h, error)
    }
  }
}

function pair({ get, post }) {
  return { get: { handler: guarded(get) }, post: { handler: guarded(post) } }
}

const disableController = {
  async get(request, h) {
    const team = await loadTeam(request)
    const asked = readEnvironments(request.query.environments)

    return chooseView(h, team, disableChoice(team), { ticked: asked })
  },
  async post(request, h) {
    const team = await loadTeam(request)
    const copy = disableChoice(team)
    const { environments, page } = environmentsOrPage(
      h,
      team,
      copy,
      readEnvironments(request.payload?.environments)
    )

    return (
      page ??
      h
        .redirect(withEnvironments(disableUrl(team, '/reason'), environments))
        .code(statusCodes.seeOther)
    )
  }
}

// What a refused Disable says that the admin can put right on the page.
function reasonRefusal(h, team, error, form) {
  if (error instanceof ApiError && REASON_CODES[error.code]) {
    return reasonView(h, team, { ...form, error: REASON_CODES[error.code] })
  }

  if (error instanceof ApiError && error.code === 'environment-not-found') {
    return environmentNotFoundView(h, team)
  }

  if (isCallFailure(error)) {
    return failedView(h, team, {
      heading: `We could not disable ${team.name}`,
      retryUrl: withEnvironments(disableUrl(team, '/reason'), form.environments)
    })
  }

  throw error
}

const disableReasonController = {
  async get(request, h) {
    const team = await loadTeam(request)
    const { environments, page } = environmentsOrPage(
      h,
      team,
      disableChoice(team),
      readEnvironments(request.query.environments)
    )

    return (
      page ?? reasonView(h, team, { environments, formKey: issueFormKey() })
    )
  },
  async post(request, h) {
    const team = await loadTeam(request)
    const { environments, page } = environmentsOrPage(
      h,
      team,
      disableChoice(team),
      readEnvironments(request.query.environments)
    )

    if (page) {
      return page
    }

    const formKey = carryFormKey(request.payload?.formKey)
    const { reason, error, text } = readReason(request.payload?.reason)
    const form = { environments, formKey, text }

    if (error) {
      return reasonView(h, team, { ...form, error })
    }

    try {
      await apiClient(request).post(
        `${TEAMS_API}/${encodeURIComponent(team.id)}/disable`,
        { reason, environments },
        {
          idempotencyKey: teamDisableKey(request, {
            teamId: team.id,
            formKey,
            reason,
            environments
          })
        }
      )
    } catch (apiError) {
      return reasonRefusal(h, team, apiError, form)
    }

    return h
      .redirect(withEnvironments(disabledUrl(team), environments))
      .code(statusCodes.seeOther)
  }
}

// A confirmation says it happened only when the team shows it did: a bookmark
// or Back lands here too.
async function disabledPage(request, h) {
  const team = await loadTeam(request)
  const requested = readEnvironments(request.query.environments)
  const known = knownEnvironments(team)

  if (requested.some((environment) => !known.includes(environment))) {
    return environmentNotFoundView(h, team)
  }

  const disabled = disabledEnvironmentsOf(team)
  const done =
    team.status === 'disabled' &&
    requested.every((environment) => disabled.includes(environment))

  return done
    ? doneView(h, team, requested)
    : h.redirect(adminTeamUrl(team)).code(statusCodes.seeOther)
}

const enableController = {
  async get(request, h) {
    const team = await loadTeam(request)
    const copy = enableChoice(team)
    const asked = request.query.environments
    const ticked = asked === undefined ? copy.offered : readEnvironments(asked)

    return chooseView(h, team, copy, { ticked })
  },
  async post(request, h) {
    const team = await loadTeam(request)
    const copy = enableChoice(team)

    if (copy.nothingToDo) {
      return chooseView(h, team, copy, { ticked: [] })
    }

    const { environments, page } = environmentsOrPage(
      h,
      team,
      copy,
      readEnvironments(request.payload?.environments)
    )

    if (page) {
      return page
    }

    try {
      await apiClient(request).post(
        `${TEAMS_API}/${encodeURIComponent(team.id)}/enable`,
        { environments }
      )
    } catch (error) {
      if (!isCallFailure(error)) {
        throw error
      }

      return failedView(h, team, {
        heading: `We could not enable ${team.name}`,
        retryUrl: enableUrl(team)
      })
    }

    setAccountNotification(request, {
      type: 'success',
      message: enableMessage(
        environments,
        copy.offered.filter(
          (environment) => !environments.includes(environment)
        )
      )
    })

    return h.redirect(adminTeamUrl(team)).code(statusCodes.seeOther)
  }
}

/**
 * The Platform Admin's pages that disable a team (which environments to
 * disable as well, then the reason, then the confirmation) and enable it
 * (which disabled environments to unlock).
 */
export const adminTeamLifecycleController = {
  disable: pair(disableController),
  disableReason: pair(disableReasonController),
  disabled: { handler: guarded(disabledPage) },
  enable: pair(enableController)
}

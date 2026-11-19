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
import {
  carryFormKey,
  issueFormKey,
  teamDisableKey
} from './credential-keys.js'
import { readReason, REASON_CODES } from './credential-reason.js'

// The pages that disable a team (a reason, then one call to the backend) and
// the button that enables it (one call). A team is environment-agnostic, so
// neither asks about environments and neither changes one: an environment is
// disabled only by Disable credentials on the Deployments tab. The call is for
// the whole team, so the backend does it once or not at all and a repeat with
// the same key is the same request. Nothing here decides who may: every page
// asks the backend for the team first, and the backend refuses anyone who is
// not a Platform Admin.

const TEAMS_API = '/v1/admin/teams'
const REASON_ANCHOR = '#reason'
const BACK_TO_TEAM = 'Back to the team'
const DISABLE_TEAM = 'Disable team'
const ACTIVE = 'active'
const DISABLED = 'disabled'

// Disable team writes the team record only, so nothing at the gateway or in an
// environment changes (design F).
const KEEPS_WORKING =
  'Its models, credentials and environments keep working: the team can still deploy models and create credentials. To stop an environment, disable its credentials on the Deployments tab.'

function disableUrl(team) {
  return `${adminTeamUrl(team)}/disable`
}

function breadcrumbsOf(team) {
  return [
    { text: 'Home', href: '/' },
    { text: 'Admin', href: ADMIN_TEAMS_URL },
    { text: 'Teams', href: ADMIN_TEAMS_URL },
    { text: team.name, href: adminTeamUrl(team) },
    { text: DISABLE_TEAM }
  ]
}

function reasonPageView(h, team, form) {
  const error = form.error ? { text: form.error } : null

  return h
    .view('admin/credential-reason', {
      pageTitle: `${error ? 'Error: ' : ''}${DISABLE_TEAM} - ${team.name} - Admin`,
      heading: DISABLE_TEAM,
      caption: team.name,
      breadcrumbs: breadcrumbsOf(team),
      tabs: adminTabs('teams'),
      deploymentUrl: adminTeamUrl(team),
      backUrl: adminTeamUrl(team),
      effect: `People in ${team.name} can view it but not change its details or its members. The team is not told why.`,
      note: KEEPS_WORKING,
      buttonText: DISABLE_TEAM,
      buttonClasses: 'govuk-button--secondary',
      formKey: form.formKey,
      reasonText: form.text ?? '',
      errorSummary: error ? [{ text: error.text, href: REASON_ANCHOR }] : null,
      fieldError: error
    })
    .code(error ? statusCodes.badRequest : statusCodes.ok)
}

function failedView(h, team) {
  return h
    .view('admin/credential-failed', {
      pageTitle: `We could not disable ${team.name} - Admin`,
      heading: `We could not disable ${team.name}`,
      breadcrumbs: breadcrumbsOf(team),
      tabs: adminTabs('teams'),
      deploymentUrl: adminTeamUrl(team),
      backText: BACK_TO_TEAM,
      doneText: null,
      retryUrl: disableUrl(team)
    })
    .code(statusCodes.badGateway)
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

function toTeam(h, team) {
  return h.redirect(adminTeamUrl(team)).code(statusCodes.seeOther)
}

// What a refused Disable says that the admin can put right on the page.
function reasonRefusal(h, team, error, form) {
  if (error instanceof ApiError && REASON_CODES[error.code]) {
    return reasonPageView(h, team, { ...form, error: REASON_CODES[error.code] })
  }

  if (isCallFailure(error)) {
    return failedView(h, team)
  }

  throw error
}

// Only an active team can be disabled; for any other the team page already
// shows what it is, so the page goes there instead of asking for a reason.
async function disableGet(request, h) {
  const team = await loadTeam(request)

  return (team.status ?? ACTIVE) === ACTIVE
    ? reasonPageView(h, team, { formKey: issueFormKey() })
    : toTeam(h, team)
}

async function disablePost(request, h) {
  const team = await loadTeam(request)

  if ((team.status ?? ACTIVE) !== ACTIVE) {
    return toTeam(h, team)
  }

  const formKey = carryFormKey(request.payload?.formKey)
  const { reason, error, text } = readReason(request.payload?.reason)
  const form = { formKey, text }

  if (error) {
    return reasonPageView(h, team, { ...form, error })
  }

  try {
    await apiClient(request).post(
      `${TEAMS_API}/${encodeURIComponent(team.id)}/disable`,
      { reason },
      {
        idempotencyKey: teamDisableKey(request, {
          teamId: team.id,
          formKey,
          reason
        })
      }
    )
  } catch (apiError) {
    return reasonRefusal(h, team, apiError, form)
  }

  setAccountNotification(request, {
    type: 'success',
    message: `${team.name} is disabled. Its people can view it but not change its details or members.`
  })

  return toTeam(h, team)
}

// Enable is one button on the team page, so it is a POST with nothing to ask.
// A team that is not disabled has nothing to enable, so the page shows it as
// it is.
async function enablePost(request, h) {
  const team = await loadTeam(request)

  if (team.status !== DISABLED) {
    return toTeam(h, team)
  }

  try {
    await apiClient(request).post(
      `${TEAMS_API}/${encodeURIComponent(team.id)}/enable`,
      {}
    )
  } catch (error) {
    if (!isCallFailure(error)) {
      throw error
    }

    setAccountNotification(request, {
      type: 'error',
      heading: `We could not enable ${team.name}`,
      message: 'Try again. What was already done is not done twice.'
    })

    return toTeam(h, team)
  }

  setAccountNotification(request, {
    type: 'success',
    message: `${team.name} is enabled.`
  })

  return toTeam(h, team)
}

/**
 * The Platform Admin's pages that disable a team (the reason, then the
 * team's page says it is disabled) and the button that enables it. Neither
 * touches an environment.
 */
export const adminTeamLifecycleController = {
  disable: { get: { handler: guarded(disableGet) } },
  disablePost: { handler: guarded(disablePost) },
  enable: { handler: guarded(enablePost) }
}

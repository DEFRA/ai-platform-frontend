import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import { adminDeploymentUrl, adminTabs } from './admin-page.js'
import {
  CREDENTIAL_ACTIONS,
  credentialIn,
  environmentChoices,
  isDone,
  readEnvironments,
  resolveEnvironments
} from './credential-actions.js'
import { carryFormKey, credentialKey, issueFormKey } from './credential-keys.js'
import { readReason } from './credential-reason.js'
import {
  DEPLOYMENTS_API,
  deploymentBreadcrumbs,
  deploymentNotFoundView,
  deploymentRefusalView,
  environmentList,
  loadDeployment
} from './deployment-page.js'

// The pages that disable, enable or revoke a team's credentials in the
// environments an admin chooses (F6, plan D5, D9, D11, D12): which
// environments, a reason (Disable and Revoke), then one call to the backend
// for each environment, so the page can name the one that failed and a repeat
// completes it. Nothing here decides who may: every page asks the backend
// for the deployment first, and the backend refuses anyone who is not a
// Platform Admin.

const REASON_CODES = {
  'reason-required': 'Enter a reason',
  'reason-too-long': 'Reason must be 500 characters or fewer'
}

const PROBLEM_TEXT = {
  none: 'Choose at least one environment',
  'not-offered': 'Choose environments from the list'
}

const ENVIRONMENTS_ANCHOR = '#environments'
const REASON_ANCHOR = '#reason'

// What the backend answers when it could not do one environment, so the page
// names it: it failed (5xx, 502 when the issuer or vault did not answer), or
// the key was already used for another request.
function isEnvironmentFailure(error) {
  return (
    error instanceof ApiError &&
    (error.statusCode >= statusCodes.internalServerError ||
      error.statusCode === statusCodes.conflict)
  )
}

function deploymentUrl(deployment) {
  return adminDeploymentUrl(deployment.team.id, deployment.environment)
}

function actionUrl(deployment, action, suffix = '') {
  return `${deploymentUrl(deployment)}/credentials/${action}${suffix}`
}

// The address of a page of an action for some environments, named in the
// address (plan D11) and checked again by the page.
function withEnvironments(url, environments) {
  return environments.length > 0
    ? `${url}?environments=${environments.map(encodeURIComponent).join(',')}`
    : url
}

function pageTitle(deployment, heading, isError = false) {
  return `${isError ? 'Error: ' : ''}${heading} - ${deployment.team.name} - Admin`
}

function pageView(h, template, deployment, heading, context) {
  return h.view(template, {
    pageTitle: pageTitle(
      deployment,
      context.titleText ?? heading,
      Boolean(context.errorSummary)
    ),
    heading,
    caption: deployment.team.name,
    breadcrumbs: deploymentBreadcrumbs(deployment, context.crumb ?? heading),
    tabs: adminTabs('deployments'),
    deploymentUrl: deploymentUrl(deployment),
    errorSummary: null,
    ...context
  })
}

// "Which environments?"
function chooseView(h, deployment, action, { ticked, problem }) {
  const copy = CREDENTIAL_ACTIONS[action]
  const items = environmentChoices(action, deployment, ticked)
  const error = problem ? { text: PROBLEM_TEXT[problem] } : null

  return pageView(h, 'admin/credential-environments', deployment, copy.title, {
    action,
    items,
    needsReason: copy.needsReason,
    buttonText: copy.needsReason ? 'Continue' : copy.title,
    buttonClasses: copy.needsReason ? '' : copy.buttonClasses,
    backUrl: deploymentUrl(deployment),
    nothingToDo: items.length === 0,
    nothingText: {
      disable: 'Every environment already has its credentials disabled.',
      enable: 'No environment has its credentials disabled.',
      revoke: 'No environment has a credential the team holds.'
    }[action],
    errorSummary: error
      ? [{ text: error.text, href: ENVIRONMENTS_ANCHOR }]
      : null,
    fieldError: error
  }).code(problem ? statusCodes.badRequest : statusCodes.ok)
}

// The reason page, which is also the confirm step. The text is shown as it
// was typed (escaped by the template).
function reasonView(h, deployment, action, form) {
  const copy = CREDENTIAL_ACTIONS[action]
  const heading = `${copy.title} in ${environmentList(form.environments)}`
  const error = form.error ? { text: form.error } : null

  return pageView(h, 'admin/credential-reason', deployment, heading, {
    titleText: heading,
    crumb: copy.title,
    action,
    effect: copy.effect,
    buttonText: copy.title,
    buttonClasses: copy.buttonClasses,
    backUrl: withEnvironments(actionUrl(deployment, action), form.environments),
    formKey: form.formKey,
    reasonText: form.text ?? '',
    errorSummary: error ? [{ text: error.text, href: REASON_ANCHOR }] : null,
    fieldError: error
  }).code(error ? statusCodes.badRequest : statusCodes.ok)
}

function doneView(h, deployment, action, environments) {
  const copy = CREDENTIAL_ACTIONS[action]

  return pageView(h, 'admin/credential-done', deployment, copy.done, {
    titleText: copy.done,
    crumb: copy.done,
    environmentsText: `in ${environmentList(environments)}`,
    effect: copy.effect
  })
}

function failedView(h, deployment, action, { done, failed }) {
  const copy = CREDENTIAL_ACTIONS[action]
  const heading = `We could not ${copy.notDone} the credentials in ${environmentList(failed)}`
  const retry = withEnvironments(
    actionUrl(deployment, action, copy.needsReason ? '/reason' : ''),
    failed
  )

  return pageView(h, 'admin/credential-failed', deployment, heading, {
    titleText: heading,
    crumb: copy.title,
    doneText:
      done.length > 0
        ? `Credentials were ${copy.past} in ${environmentList(done)}.`
        : null,
    retryUrl: retry
  }).code(statusCodes.badGateway)
}

function credentialsPath(deployment, environment, action) {
  return `${DEPLOYMENTS_API}/${encodeURIComponent(deployment.team.id)}/${encodeURIComponent(environment)}/credentials/${action}`
}

// One environment: the call, with the reason and a key of its own for Disable
// and Revoke. Resolves `done`, `failed`, or `nothing` when the backend says a
// Revoke revoked nothing (the credential was already gone); what the backend
// refused that the admin cannot put right here (a refusal of role, a team
// that is gone, a reason it will not take) is thrown for the page to say.
async function applyToEnvironment(request, args) {
  const { action, deployment, environment, reason, formKey } = args
  const path = credentialsPath(deployment, environment, action)

  try {
    if (CREDENTIAL_ACTIONS[action].needsReason) {
      const result = await apiClient(request).post(
        path,
        { reason },
        {
          idempotencyKey: credentialKey(request, {
            action,
            teamId: deployment.team.id,
            environment,
            formKey,
            reason
          })
        }
      )

      return action === 'revoke' && result?.revoked === 0 ? 'nothing' : 'done'
    }

    await apiClient(request).post(path)

    return 'done'
  } catch (error) {
    if (isEnvironmentFailure(error)) {
      return 'failed'
    }

    throw error
  }
}

// Every environment is tried, so one that fails does not stop the others and
// the page can say which did.
async function applyToEnvironments(request, args) {
  const outcomes = { done: [], failed: [], nothing: [] }

  for (const environment of args.environments) {
    const outcome = await applyToEnvironment(request, { ...args, environment })

    outcomes[outcome].push(environment)
  }

  return outcomes
}

// What the deployment page says when a Revoke left some environments with
// nothing to revoke: it does not say "revoked" for those.
function nothingToRevokeMessage({ done, nothing }) {
  const none = `There was no credential to revoke in ${environmentList(nothing)}.`

  return done.length > 0
    ? `Credentials revoked in ${environmentList(done)}. ${none}`
    : none
}

async function finish(request, h, args) {
  const { action, deployment } = args
  const { done, failed, nothing } = await applyToEnvironments(request, args)

  if (failed.length > 0) {
    return failedView(h, deployment, action, { done, failed })
  }

  const copy = CREDENTIAL_ACTIONS[action]

  if (nothing.length > 0) {
    setAccountNotification(request, {
      type: 'info',
      message: nothingToRevokeMessage({ done, nothing })
    })

    return h.redirect(deploymentUrl(deployment)).code(statusCodes.seeOther)
  }

  if (copy.needsReason) {
    return h
      .redirect(withEnvironments(actionUrl(deployment, copy.past), done))
      .code(statusCodes.seeOther)
  }

  setAccountNotification(request, {
    type: 'success',
    message: `Credentials ${copy.past} in ${environmentList(done)}.`
  })

  return h.redirect(deploymentUrl(deployment)).code(statusCodes.seeOther)
}

// The environments a page is for, or the page to show instead: the 404 page
// for one the team does not have, the choice again for none or one that is not
// offered.
function environmentsOrPage(h, deployment, action, requested) {
  const resolved = resolveEnvironments(action, deployment, requested)

  if (resolved.problem === 'unknown') {
    return { page: deploymentNotFoundView(h) }
  }

  if (resolved.problem) {
    return {
      page: chooseView(h, deployment, action, {
        ticked: requested,
        problem: resolved.problem
      })
    }
  }

  return { environments: resolved.environments }
}

function chooseController(action) {
  return {
    get: async (request, h) => {
      const deployment = await loadDeployment(
        request,
        request.params.teamId,
        request.params.environment
      )
      const asked = readEnvironments(request.query.environments)

      return chooseView(h, deployment, action, {
        ticked: asked.length > 0 ? asked : [deployment.environment]
      })
    },
    post: async (request, h) => {
      const deployment = await loadDeployment(
        request,
        request.params.teamId,
        request.params.environment
      )
      const requested = readEnvironments(request.payload?.environments)
      const { environments, page } = environmentsOrPage(
        h,
        deployment,
        action,
        requested
      )

      if (page) {
        return page
      }

      if (!CREDENTIAL_ACTIONS[action].needsReason) {
        return finish(request, h, { action, deployment, environments })
      }

      return h
        .redirect(
          withEnvironments(
            actionUrl(deployment, action, '/reason'),
            environments
          )
        )
        .code(statusCodes.seeOther)
    }
  }
}

function reasonController(action) {
  async function load(request, h) {
    const deployment = await loadDeployment(
      request,
      request.params.teamId,
      request.params.environment
    )

    return {
      deployment,
      ...environmentsOrPage(
        h,
        deployment,
        action,
        readEnvironments(request.query.environments)
      )
    }
  }

  return {
    get: async (request, h) => {
      const { deployment, environments, page } = await load(request, h)

      return (
        page ??
        reasonView(h, deployment, action, {
          environments,
          formKey: issueFormKey()
        })
      )
    },
    post: async (request, h) => {
      const { deployment, environments, page } = await load(request, h)

      if (page) {
        return page
      }

      const formKey = carryFormKey(request.payload?.formKey)
      const { reason, error, text } = readReason(request.payload?.reason)

      if (error) {
        return reasonView(h, deployment, action, {
          environments,
          formKey,
          error,
          text
        })
      }

      try {
        return await finish(request, h, {
          action,
          deployment,
          environments,
          reason,
          formKey
        })
      } catch (apiError) {
        if (apiError instanceof ApiError && REASON_CODES[apiError.code]) {
          return reasonView(h, deployment, action, {
            environments,
            formKey,
            error: REASON_CODES[apiError.code],
            text
          })
        }

        throw apiError
      }
    }
  }
}

function doneController(action) {
  return async (request, h) => {
    const deployment = await loadDeployment(
      request,
      request.params.teamId,
      request.params.environment
    )
    const requested = readEnvironments(request.query.environments)
    const known = new Set([
      deployment.environment,
      ...(deployment.environments ?? []).map(({ environment }) => environment)
    ])

    if (
      requested.length === 0 ||
      requested.some((environment) => !known.has(environment))
    ) {
      return deploymentNotFoundView(h)
    }

    // A confirmation says it happened only when the deployment shows it did:
    // a bookmark or Back lands here too.
    return requested.every((environment) =>
      isDone(action, credentialIn(deployment, environment))
    )
      ? doneView(h, deployment, action, requested)
      : h.redirect(deploymentUrl(deployment)).code(statusCodes.seeOther)
  }
}

// Each page is asked for the deployment first, which is the check; whatever
// the backend refuses is shown as the Admin area shows it.
function guarded(handler) {
  return async (request, h) => {
    try {
      return await handler(request, h)
    } catch (error) {
      return deploymentRefusalView(request, h, error)
    }
  }
}

function guardedPair({ get, post }) {
  return { get: { handler: guarded(get) }, post: { handler: guarded(post) } }
}

/**
 * The Platform Admin's credential pages for a team's deployment: Disable and
 * Revoke ask which environments and why; Enable asks which environments and
 * acts. Each has the pages for them and the confirmation after.
 */
export const adminCredentialsController = {
  disable: guardedPair(chooseController('disable')),
  disableReason: guardedPair(reasonController('disable')),
  disabled: { handler: guarded(doneController('disable')) },
  revoke: guardedPair(chooseController('revoke')),
  revokeReason: guardedPair(reasonController('revoke')),
  revoked: { handler: guarded(doneController('revoke')) },
  enable: guardedPair(chooseController('enable'))
}

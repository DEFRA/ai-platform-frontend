import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { setAccountNotification } from '#/server/common/helpers/session.js'
import { adminDeploymentUrl, adminTabs, isCallFailure } from './admin-page.js'
import {
  CREDENTIAL_ACTIONS,
  credentialIn,
  enableNote,
  environmentChoices,
  isDone,
  readEnvironments,
  resolveEnvironments
} from './credential-actions.js'
import { carryFormKey, credentialKey, issueFormKey } from './credential-keys.js'
import { readReason, REASON_CODES } from './credential-reason.js'
import {
  DEPLOYMENTS_API,
  deploymentBreadcrumbs,
  deploymentNotFoundView,
  deploymentRefusalView,
  environmentList,
  loadDeployment
} from './deployment-page.js'

// The pages that disable or enable a team's credentials in the environments an
// admin chooses (F6, plan D5, D9, D11, D12): which environments, a reason
// (Disable), then one call to the backend for each environment, so the page can
// name the one that failed and a repeat completes it. Nothing here decides who
// may: every page asks the backend for the deployment first, and the backend
// refuses anyone who is not a Platform Admin. Revoking is one secret at a time
// (deployment-secret-revoke.js), not here.

const PROBLEM_TEXT = {
  none: 'Choose at least one environment',
  'not-offered': 'Choose environments from the list'
}

const ENVIRONMENTS_ANCHOR = '#environments'
const REASON_ANCHOR = '#reason'

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

/**
 * A page of the credential actions on a team's deployment: its title,
 * caption, breadcrumbs and the way back, with what the page adds.
 * @param {import('@hapi/hapi').ResponseToolkit} h
 * @param {string} template
 * @param {object} deployment - What the backend gave.
 * @param {string} heading
 * @param {object} context
 * @returns {import('@hapi/hapi').ResponseObject}
 */
export function pageView(h, template, deployment, heading, context) {
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
    enableNote: action === 'enable' ? enableNote(deployment) : null,
    nothingText: {
      disable: 'Every environment already has its credentials disabled.',
      enable: 'No environment has its credentials disabled.'
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

// One environment: the call, with the reason and a key of its own for Disable.
// Resolves `done` or `failed`; what the backend refused that the admin cannot
// put right here (a refusal of role, a team that is gone, a reason it will not
// take) is thrown for the page to say.
async function applyToEnvironment(request, args) {
  const { action, deployment, environment, reason, formKey } = args
  const path = credentialsPath(deployment, environment, action)

  try {
    if (CREDENTIAL_ACTIONS[action].needsReason) {
      await apiClient(request).post(
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

      return 'done'
    }

    await apiClient(request).post(path)

    return 'done'
  } catch (error) {
    // What the backend answers when it could not do this environment, so the
    // page names it: it failed (5xx, 502 when the issuer or vault did not
    // answer), or the key was already used for another request.
    if (isCallFailure(error)) {
      return 'failed'
    }

    throw error
  }
}

// Every environment is tried, so one that fails does not stop the others and
// the page can say which did. Each is its own call, under its own lock in the
// backend, so they run together; the lists keep the order chosen.
async function applyToEnvironments(request, args) {
  const { environments } = args
  const outcomes = await Promise.all(
    environments.map((environment) =>
      applyToEnvironment(request, { ...args, environment })
    )
  )

  return {
    done: environments.filter((_, index) => outcomes[index] === 'done'),
    failed: environments.filter((_, index) => outcomes[index] === 'failed')
  }
}

async function finish(request, h, args) {
  const { action, deployment } = args
  const { done, failed } = await applyToEnvironments(request, args)

  if (failed.length > 0) {
    return failedView(h, deployment, action, { done, failed })
  }

  const copy = CREDENTIAL_ACTIONS[action]

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
/**
 * Wraps a page's handler so what the backend refuses is shown as the Admin
 * area shows it.
 * @param {(request: import('@hapi/hapi').Request, h: import('@hapi/hapi').ResponseToolkit) => Promise<unknown>} handler
 * @returns {(request: import('@hapi/hapi').Request, h: import('@hapi/hapi').ResponseToolkit) => Promise<unknown>}
 */
export function guarded(handler) {
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
 * The Platform Admin's credential pages for a team's deployment: Disable asks
 * which environments and why; Enable asks which environments and acts. Disable
 * has the pages for it and the confirmation after.
 */
export const adminCredentialsController = {
  disable: guardedPair(chooseController('disable')),
  disableReason: guardedPair(reasonController('disable')),
  disabled: { handler: guarded(doneController('disable')) },
  enable: guardedPair(chooseController('enable'))
}

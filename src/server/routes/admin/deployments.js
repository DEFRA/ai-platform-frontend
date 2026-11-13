import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import { buildPagination } from '#/server/common/helpers/pagination.js'
import { formatUkDateTime } from '#/server/common/helpers/uk-time.js'
import { ADMIN_TEAMS_URL, adminDeploymentUrl, adminTabs } from './admin-page.js'
import { deploymentRefusalView } from './deployment-page.js'
import {
  CREDENTIAL_FILTERS,
  credentialStatus,
  credentialTag,
  STATUS_FILTERS,
  statusTag
} from './deployment-labels.js'
import {
  deploymentsUrl,
  FORM_ANCHOR,
  readDeploymentsQuery
} from './deployments-query.js'
import { pastEnd } from './past-end.js'
import { selectItems } from './select-items.js'

const LIST_API = '/v1/admin/team-deployments'
const FILTER_FIELDS = ['search', 'model', 'status', 'credential']

const BACKEND_REFUSED = {
  errorSummary: [
    {
      text: 'The filters could not be used. Clear the filters and try again',
      href: FORM_ANCHOR
    }
  ],
  fieldErrors: {}
}

/**
 * One deployment as a row of the table.
 * @param {object} deployment
 * @returns {object}
 */
export function buildDeploymentRow(deployment) {
  return {
    team: {
      name: deployment.teamName,
      href: adminDeploymentUrl(deployment.teamId, deployment.environment)
    },
    models:
      deployment.models.length > 0
        ? deployment.models.map(({ name }) => name).join(', ')
        : 'None',
    status: statusTag(deployment.status),
    credential: credentialTag(credentialStatus(deployment.credential)),
    at: deployment.lastChangedAt,
    when: formatUkDateTime(deployment.lastChangedAt)
  }
}

// A tab for each environment, the one shown marked. Changing environment
// starts again: the filters are for the environment they were made in.
function environmentTabs(options, environment) {
  return options.environments.map((code) => ({
    text: environmentName(code),
    href: deploymentsUrl({ environment: code }),
    current: code === environment
  }))
}

function modelItems(options, selected) {
  return selectItems({
    all: 'All models',
    choices: options.models.map(({ slug, name }) => ({
      value: slug,
      text: name
    })),
    selected,
    unknownText: (slug) => slug
  })
}

function deploymentsView(h, { filters, options, result, errors }) {
  const { deployments = [], page = 1, pageSize = 0, total = 0 } = result ?? {}
  const environment = result?.environment ?? filters.environment
  const first = deployments.length > 0 ? (page - 1) * pageSize + 1 : 0
  const environmentLabel = environment ? environmentName(environment) : null
  const clearUrl = deploymentsUrl({ environment })

  return h.view('admin/deployments', {
    pageTitle: `${errors ? 'Error: ' : ''}Deployments - Admin`,
    heading: 'Deployments',
    breadcrumbs: [
      { text: 'Home', href: '/' },
      { text: 'Admin', href: ADMIN_TEAMS_URL },
      { text: 'Deployments' }
    ],
    tabs: adminTabs('deployments'),
    environmentTabs: environmentTabs(options, environment),
    environment,
    environmentLabel,
    values: { search: filters.search },
    modelItems: modelItems(options, filters.model),
    statusItems: selectItems({
      all: STATUS_FILTERS[0].text,
      choices: STATUS_FILTERS.slice(1),
      selected: filters.status,
      unknownText: (value) => value
    }),
    credentialItems: selectItems({
      all: CREDENTIAL_FILTERS[0].text,
      choices: CREDENTIAL_FILTERS.slice(1),
      selected: filters.credential,
      unknownText: (value) => value
    }),
    filtered: FILTER_FIELDS.some((field) => filters[field]),
    clearUrl,
    searched: result !== undefined,
    pastEnd: result
      ? pastEnd({
          shown: deployments.length,
          page,
          pageSize,
          total,
          nouns: ['deployment', 'deployments'],
          href: (number) => deploymentsUrl({ ...filters, environment }, number)
        })
      : null,
    rows: deployments.map(buildDeploymentRow),
    total,
    first,
    last: first === 0 ? 0 : first + deployments.length - 1,
    pagination: result
      ? buildPagination(result, (number) =>
          deploymentsUrl({ ...filters, environment }, number)
        )
      : null,
    errorSummary: errors?.errorSummary ?? null,
    fieldErrors: errors?.fieldErrors ?? {}
  })
}

// The environments and models the tabs and the model filter need come with
// the rows, so a page that has no rows to show (a filter that is wrong) asks
// for the unfiltered first page to get them. The rows are not used.
async function loadOptions(request) {
  const { options } = await apiClient(request).get(LIST_API)

  return options
}

async function invalidView(request, h, filters, errors) {
  return deploymentsView(h, {
    filters,
    options: await loadOptions(request),
    errors
  }).code(statusCodes.badRequest)
}

async function showDeployments(request, h) {
  const { filters, apiQuery, errors } = readDeploymentsQuery(request.query)

  if (errors) {
    return invalidView(request, h, filters, errors)
  }

  try {
    const result = await apiClient(request).get(
      `${LIST_API}${apiQuery ? `?${apiQuery}` : ''}`
    )

    return deploymentsView(h, { filters, options: result.options, result })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'invalid-query') {
      return invalidView(request, h, filters, BACKEND_REFUSED)
    }

    throw error
  }
}

/**
 * The Platform Admin's Deployments tab: each team's deployment in one
 * environment at a time, found by team name, model, status and credential.
 * The page asks the backend on every request; the backend decides who may
 * read it and records a refusal (plan D2).
 */
export const adminDeploymentsController = {
  async handler(request, h) {
    try {
      return await showDeployments(request, h)
    } catch (error) {
      return deploymentRefusalView(request, h, error)
    }
  }
}

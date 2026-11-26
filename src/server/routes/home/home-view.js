import { differenceInCalendarDays } from 'date-fns'

import { formatDate } from '#/config/nunjucks/filters/format-date.js'
import { apiClient } from '#/server/common/helpers/api-client.js'
import {
  DEPLOYMENT_FAILURE_STATUSES,
  DEPLOYMENT_REMOVING_STATUS,
  isDeploymentInProgress
} from '#/server/common/helpers/deployment-status.js'
import {
  environmentName,
  teamEnvironmentList
} from '#/server/common/helpers/environment-names.js'
import { pageOfRows } from '#/server/common/helpers/pagination.js'
import { buildKeyRows } from '#/server/routes/manage/access-view.js'
import { joinNames } from '#/server/routes/connect/team-model-choices.js'
import { requestUrl } from '#/server/routes/environments/environment-view.js'
import { teamUrl } from '#/server/routes/teams/team-view.js'
import { readUsageSummary } from '#/server/routes/usage/usage-api.js'
import { homeUsageOf } from '#/server/routes/usage/usage-pages.js'

const ACTIVE_STATUS = 'active'
// A personal key this close to running out is called out on the page.
const RENEWAL_WARNING_DAYS = 3

// A page of "Your teams" or of the usage table, each of which keeps its place
// on the home page and the page the other table is on.
function homeTablePageUrl(request, { own, anchor }) {
  const other = own === 'page' ? 'usagePage' : 'page'
  const kept = request.query?.[other]

  return (number) => {
    const keep = kept ? `&${other}=${encodeURIComponent(kept)}` : ''

    return `/?${own}=${number}${keep}#${anchor}`
  }
}

function isFailed({ status }) {
  return DEPLOYMENT_FAILURE_STATUSES.includes(status)
}

// Being set up: on its way, whether or not it has started. A removal is the
// team page's to show.
function isSettingUp({ status }) {
  return isDeploymentInProgress(status) && status !== DEPLOYMENT_REMOVING_STATUS
}

function modelNameOf(modelNames, { modelSlug }) {
  return modelNames[modelSlug] ?? modelSlug
}

function unique(names) {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

function teamAttention({ team, deployments }, modelNames) {
  const line = (deployment, sentence, linkText) => ({
    text: `${modelNameOf(modelNames, deployment)} ${sentence} ${team.name}.`,
    linkText,
    href: requestUrl(team, deployment)
  })

  return {
    failed: deployments
      .filter(isFailed)
      .map((deployment) =>
        line(deployment, 'could not be set up for', 'See what happened')
      ),
    settingUp: deployments
      .filter(isSettingUp)
      .map((deployment) =>
        line(deployment, 'is being set up for', 'Check progress')
      )
  }
}

function keyAttention(keyRows) {
  return keyRows
    .filter(
      ({ expired, expiresAt }) =>
        !expired &&
        Boolean(expiresAt) &&
        differenceInCalendarDays(new Date(expiresAt), new Date()) <=
          RENEWAL_WARNING_DAYS
    )
    .map((key) => ({
      text: `Your key for ${key.modelDisplayName} runs out on ${formatDate(key.expiresAt)}.`,
      linkText: 'Renew it',
      href: `/manage/credentials/${encodeURIComponent(key._id)}`
    }))
}

/**
 * What needs the person's attention, worst first: a model that could not be
 * set up, a model being set up, then a personal key close to running out. Each
 * is a sentence and the link that follows it. Empty when nothing does.
 * @param {Array<{team: object, deployments: object[]}>} teamReads - Each of the person's teams with its deployments.
 * @param {object[]} keyRows - The person's own keys, as on Personal access.
 * @param {Record<string, string>} modelNames - Display names by slug.
 * @returns {Array<{text: string, linkText: string, href: string}>}
 */
export function buildAttention(teamReads, keyRows, modelNames) {
  const teams = teamReads.map((read) => teamAttention(read, modelNames))

  return [
    ...teams.flatMap(({ failed }) => failed),
    ...teams.flatMap(({ settingUp }) => settingUp),
    ...keyAttention(keyRows)
  ]
}

// "GPT-4o in Development." for each environment holding ready models, in the
// order a team meets them, then "GPT-4o setting up." for those on their way.
function modelSentences(deployments, modelNames) {
  const order = teamEnvironmentList().map(({ environment }) => environment)
  const readyByEnvironment = new Map()

  for (const deployment of deployments.filter(
    ({ status }) => status === ACTIVE_STATUS
  )) {
    const names = readyByEnvironment.get(deployment.environment) ?? []

    readyByEnvironment.set(deployment.environment, [
      ...names,
      modelNameOf(modelNames, deployment)
    ])
  }

  const rank = (environment) =>
    order.includes(environment) ? order.indexOf(environment) : order.length

  const ready = [...readyByEnvironment]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(
      ([environment, names]) =>
        `${joinNames(unique(names))} in ${environmentName(environment)}.`
    )
  const settingUp = unique(
    deployments.filter(isSettingUp).map((d) => modelNameOf(modelNames, d))
  )

  return settingUp.length > 0
    ? [...ready, `${joinNames(settingUp)} setting up.`]
    : ready
}

/**
 * One row of "Your teams": the team, linked to its page, and what the
 * person is in it and which models it has. A team whose deployments could not
 * be read says so rather than claiming it has none.
 * @param {{team: object, deployments: object[] | null}} teamRead
 * @param {Record<string, string>} modelNames - Display names by slug.
 * @returns {{name: string, href: string, summary: string}}
 */
export function buildTeamRow({ team, deployments }, modelNames) {
  const role = team.role === 'admin' ? 'Admin' : 'Member'
  const sentences = deployments ? modelSentences(deployments, modelNames) : null
  let rest = 'We could not check its models just now.'

  if (sentences) {
    rest = sentences.length > 0 ? sentences.join(' ') : 'No models yet.'
  }

  return { name: team.name, href: teamUrl(team), summary: `${role}. ${rest}` }
}

/**
 * The "Your own keys" line: how many keys the person holds themselves, for
 * which models, and when the first runs out. Expired keys are not counted:
 * Personal access still lists them.
 * @param {object[]} keyRows - The person's own keys, as on Personal access.
 * @returns {{text: string, hasKeys: boolean}}
 */
export function buildKeysSummary(keyRows) {
  const keys = keyRows.filter(({ expired }) => !expired)

  if (keys.length === 0) {
    return { text: 'You have no keys of your own.', hasKeys: false }
  }

  const [first] = keys
    .filter(({ expiresAt }) => Boolean(expiresAt))
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))
  const models = joinNames(unique(keys.map((key) => key.modelDisplayName)))
  const count = `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`
  const subject = keys.length === 1 ? 'It expires' : 'The first expires'
  const expiry = first ? ` ${subject} on ${formatDate(first.expiresAt)}.` : ''

  return { text: `You have ${count}, for ${models}.${expiry}`, hasKeys: true }
}

function modelNamesFrom(catalogue) {
  return Object.fromEntries(
    (catalogue?.items ?? []).map((model) => [model.slug, model.displayName])
  )
}

function logFailed(request, read, message) {
  if (read.status === 'rejected') {
    request.logger.warn({ err: read.reason }, message)
  }
}

// The four first reads, together; each one that fails is logged and left
// as a rejected read for the caller to leave out.
async function readHomeBasics(request, client) {
  const [teamsRead, credentialsRead, catalogueRead, usageRead] =
    await Promise.allSettled([
      client.get('/v1/teams'),
      client.get('/v1/credentials'),
      client.get('/v1/models?includeIneligible=true'),
      readUsageSummary(request)
    ])

  logFailed(request, teamsRead, 'Could not read the teams for the home page')
  logFailed(
    request,
    credentialsRead,
    'Could not read the keys for the home page'
  )
  logFailed(
    request,
    catalogueRead,
    'Could not read the model names for the home page'
  )
  logFailed(request, usageRead, 'Could not read the usage for the home page')

  return { teamsRead, credentialsRead, catalogueRead, usageRead }
}

// Every team is read (what needs attention looks across all of them); the
// table shows 10 to a page.
function teamsPageOf(request, teams, teamReads, modelNames) {
  return teams
    ? pageOfRows(
        teamReads.map((teamRead) => buildTeamRow(teamRead, modelNames)),
        {
          page: request.query?.page,
          href: homeTablePageUrl(request, { own: 'page', anchor: 'your-teams' })
        }
      )
    : null
}

// What Home shows of usage, with the table of teams 10 to a page.
function usageOf(request, summary) {
  const usage = summary ? homeUsageOf(summary) : null

  if (!usage) {
    return null
  }

  const rowsPage = pageOfRows(usage.rows, {
    page: request.query?.usagePage,
    href: homeTablePageUrl(request, { own: 'usagePage', anchor: 'home-usage' })
  })

  return { ...usage, rows: rowsPage.rows, rowsPage }
}

/**
 * Everything the signed-in home page shows, from the person's teams (one read
 * of each team's deployments, D9), their credentials and the catalogue for
 * names. Each part is best-effort: one that cannot be read says so, and the
 * rest still shows, so a backend hiccup never takes the front door down.
 * @param {import('@hapi/hapi').Request} request
 * @returns {Promise<{attention: object[], teams: object[] | null, keys: {text: string, hasKeys: boolean} | null}>}
 */
export async function loadHomeView(request) {
  const client = apiClient(request)
  const { teamsRead, credentialsRead, catalogueRead, usageRead } =
    await readHomeBasics(request, client)
  const modelNames = modelNamesFrom(catalogueRead.value)
  const usage = usageOf(request, usageRead.value)
  const teams = teamsRead.value?.items ?? null
  const deploymentReads = await Promise.allSettled(
    (teams ?? []).map((team) =>
      client.get(`/v1/teams/${encodeURIComponent(team.slug)}/deployments`)
    )
  )

  deploymentReads.forEach((read) =>
    logFailed(request, read, 'Could not read a team’s models for the home page')
  )

  const teamReads = (teams ?? []).map((team, index) => ({
    team,
    deployments: deploymentReads[index].value?.items ?? null
  }))
  const keyRows = credentialsRead.value
    ? buildKeyRows(credentialsRead.value.items, modelNames)
    : null
  const teamsPage = teamsPageOf(request, teams, teamReads, modelNames)

  return {
    attention: [
      ...buildAttention(
        teamReads.filter(({ deployments }) => deployments),
        keyRows ?? [],
        modelNames
      ),
      ...(usage?.attention ?? [])
    ],
    usage,
    teams: teamsPage?.rows ?? null,
    teamsPage,
    keys: keyRows ? buildKeysSummary(keyRows) : null
  }
}

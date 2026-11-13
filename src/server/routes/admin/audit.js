import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError, apiClient } from '#/server/common/helpers/api-client.js'
import { environmentName } from '#/server/common/helpers/environment-names.js'
import { buildPagination } from '#/server/common/helpers/pagination.js'
import { formatUkDateTime } from '#/server/common/helpers/uk-time.js'
import {
  ADMIN_AUDIT_URL,
  ADMIN_TEAMS_URL,
  adminRefusalView,
  adminTabs
} from './admin-page.js'
import {
  ACTION_OPTIONS,
  ACTOR_TYPES,
  actionLabel,
  actorTypeLabel,
  outcomeTag
} from './audit-labels.js'
import {
  auditFormQuery,
  auditUrl,
  FORM_ANCHOR,
  readAuditQuery
} from './audit-query.js'

const AUDIT_API = '/v1/admin/audit'

const BACKEND_REFUSED = {
  errorSummary: [
    {
      text: 'The filters could not be used. Clear the filters and try again',
      href: FORM_ANCHOR
    }
  ],
  fieldErrors: {},
  dateErrors: {}
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

// What to say when the page asked for is past the last: the backend answers
// it with no events and the real total, so there is no count to show over an
// empty table, only where the pages are.
function pastEnd(filters, { events, page, pageSize, total }) {
  if (events.length > 0 || total === 0) {
    return null
  }

  const pages = Math.ceil(total / pageSize)
  const links = [{ text: 'Go to page 1', href: auditUrl(filters, 1) }]

  if (pages > 1) {
    links.push({
      text: `Go to page ${pages} (the last page)`,
      href: auditUrl(filters, pages)
    })
  }

  return {
    page,
    summary: `There ${total === 1 ? 'is' : 'are'} ${plural(total, 'event', 'events')} on ${plural(pages, 'page', 'pages')}.`,
    links
  }
}

// A select's items: the first says "all", then the choices, and a value that
// is asked for but not on the list still shows, so the form says what was
// asked.
function selectItems({ all, choices, selected, unknownText }) {
  const known = choices.some(({ value }) => value === selected)
  const extra =
    selected && !known ? [{ value: selected, text: unknownText(selected) }] : []

  return [{ value: '', text: all }, ...choices, ...extra].map((item) => ({
    ...item,
    selected: item.value === selected
  }))
}

function filterItems(filters, options) {
  return {
    teamItems: selectItems({
      all: 'All teams',
      choices: options.teams.map(({ id, name }) => ({
        value: id,
        text: name
      })),
      selected: filters.team,
      unknownText: () => 'Unknown team'
    }),
    environmentItems: selectItems({
      all: 'All environments',
      choices: options.environments.map((value) => ({
        value,
        text: environmentName(value)
      })),
      selected: filters.environment,
      unknownText: environmentName
    }),
    actionItems: selectItems({
      all: 'All actions',
      choices: ACTION_OPTIONS,
      selected: filters.action,
      unknownText: (action) => actionLabel({ action })
    }),
    actorTypeItems: selectItems({
      all: 'All actor types',
      choices: ACTOR_TYPES,
      selected: filters.actorType,
      unknownText: actorTypeLabel
    })
  }
}

// The three boxes of a date, the ones the error is about marked.
function dateItems(values, markedParts = []) {
  const widths = { day: '2', month: '2', year: '4' }

  return ['day', 'month', 'year'].map((name) => ({
    name,
    value: values[name],
    classes: `govuk-input--width-${widths[name]}${markedParts.includes(name) ? ' govuk-input--error' : ''}`
  }))
}

/**
 * One event as a row of the table. What the page cannot name is said so, and
 * only the fields the backend gives for display are used.
 * @param {object} event
 * @returns {object}
 */
export function buildAuditRow(event) {
  const { actor, subject, team } = event
  const isSystem = actor.type === 'system'

  return {
    at: event.at,
    when: formatUkDateTime(event.at),
    who: {
      name: actor.displayName ?? (isSystem ? 'System' : 'Unknown person'),
      type: isSystem ? null : actorTypeLabel(actor.type)
    },
    action: actionLabel(event),
    subject: subject ? (subject.displayName ?? 'Unknown person') : null,
    reason: event.reason ?? null,
    team: team ? (team.name ?? 'Team no longer exists') : 'None',
    environment: event.environment
      ? environmentName(event.environment)
      : 'None',
    outcome: outcomeTag(event)
  }
}

function auditView(h, { filters, options, result, errors }) {
  const { events = [], page = 1, pageSize = 0, total = 0 } = result ?? {}
  const first = events.length > 0 ? (page - 1) * pageSize + 1 : 0
  const fieldErrors = errors?.fieldErrors ?? {}
  const dateErrors = errors?.dateErrors ?? {}

  return h.view('admin/audit', {
    pageTitle: `${errors ? 'Error: ' : ''}Audit log - Admin`,
    heading: 'Audit log',
    breadcrumbs: [
      { text: 'Home', href: '/' },
      { text: 'Admin', href: ADMIN_TEAMS_URL },
      { text: 'Audit log' }
    ],
    tabs: adminTabs('audit'),
    ...filterItems(filters, options),
    values: { person: filters.person },
    fromItems: dateItems(filters.from, dateErrors.from),
    toItems: dateItems(filters.to, dateErrors.to),
    filtered: Object.keys(auditFormQuery(filters)).length > 0,
    clearUrl: ADMIN_AUDIT_URL,
    searched: result !== undefined,
    pastEnd: result
      ? pastEnd(filters, { events, page, pageSize, total })
      : null,
    rows: events.map(buildAuditRow),
    total,
    first,
    last: first === 0 ? 0 : first + events.length - 1,
    retentionDays: result?.retentionDays,
    pagination: result
      ? buildPagination(result, (number) => auditUrl(filters, number))
      : null,
    errorSummary: errors?.errorSummary ?? null,
    fieldErrors
  })
}

// The lists the Team and Environment filters need come with the events, so a
// page that has no events to show (a filter that is wrong) asks for the
// unfiltered first page to get them. The events are not used.
async function loadOptions(request) {
  const { options } = await apiClient(request).get(AUDIT_API)

  return options
}

async function invalidView(request, h, filters, errors) {
  return auditView(h, {
    filters,
    options: await loadOptions(request),
    errors
  }).code(statusCodes.badRequest)
}

async function showAuditLog(request, h) {
  const { filters, apiQuery, errors } = readAuditQuery(request.query)

  if (errors) {
    return invalidView(request, h, filters, errors)
  }

  try {
    const result = await apiClient(request).get(
      `${AUDIT_API}${apiQuery ? `?${apiQuery}` : ''}`
    )

    return auditView(h, { filters, options: result.options, result })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'invalid-query') {
      return invalidView(request, h, filters, BACKEND_REFUSED)
    }

    throw error
  }
}

/**
 * The Platform Admin's Audit log tab: every audit event, newest first, found
 * by team, environment, person, action, actor type and day. The page asks the
 * backend on every request; the backend decides who may read it and records a
 * refusal (plan D2).
 */
export const adminAuditController = {
  async handler(request, h) {
    try {
      return await showAuditLog(request, h)
    } catch (error) {
      return adminRefusalView(request, h, error)
    }
  }
}

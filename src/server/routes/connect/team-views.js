import { statusCodes } from '#/server/common/constants/status-codes.js'
import { apiClient } from '#/server/common/helpers/api-client.js'
import {
  defaultTeamEnvironment,
  environmentName,
  environmentSetUpUrl
} from '#/server/common/helpers/environment-names.js'
import { hasCompletedTeamJourney, stepUrl } from './team-journey.js'
import { buildTeamItems } from './team-choices.js'
import {
  buildModelCheckboxes,
  joinNames,
  notInRegionsSentence
} from './team-model-choices.js'

export const SELECT_URL = '/connect/team/select'
export const MODEL_URL = '/connect/team/model'
export const DETAILS_URL = '/connect/team/details'
export const CHECK_URL = '/connect/team/check'
export const NEW_TEAM_URL = `/teams/new?returnTo=${encodeURIComponent(SELECT_URL)}`

const SELECT_HEADING = 'Which team is this for?'
const MODEL_HEADING = 'Which models does your team need?'
const DETAILS_HEADING = 'What will your team use it for? (optional)'
const CHECK_ANSWERS_TITLE = 'Check your answers'

export function redirectToStart(h) {
  return h.redirect('/models').takeover()
}

// No environment is configured for teams to deploy to, so there is nothing
// to state or save on the details step: say so rather than lose the journey.
export function environmentUnavailableView(h) {
  return h
    .view('error/index', {
      pageTitle: 'No environment is available yet',
      heading: 'No environment is available yet',
      message:
        'Models cannot be set up for a team in any environment yet. Try again later.',
      actionHref: '/models',
      actionText: 'Browse models'
    })
    .code(statusCodes.serviceUnavailable)
}

// The previous step of the journey, or the check page for a step opened from
// "Change" there. The model step is skipped when one model came from its
// page, so the details step goes back past it.
const BACK_LINKS = {
  select: (pendingAccess) =>
    pendingAccess.modelSlug ? `/models/${pendingAccess.modelSlug}` : '/models',
  model: () => SELECT_URL,
  details: (pendingAccess) =>
    pendingAccess.modelStepSkipped ? SELECT_URL : MODEL_URL
}

// The page before the check page: the details step, or for models set up in
// another environment, that environment's own page, which skips the rest.
function checkBackLink(pendingAccess) {
  return pendingAccess.environment &&
    pendingAccess.environment !== defaultTeamEnvironment()
    ? environmentSetUpUrl(pendingAccess.teamSlug, pendingAccess.environment)
    : DETAILS_URL
}

function backHref(step, pendingAccess, change) {
  // The check page only takes a person back once every answer is there: after
  // changing the team the models are asked for again.
  return change && hasCompletedTeamJourney(pendingAccess)
    ? CHECK_URL
    : BACK_LINKS[step](pendingAccess)
}

// A form of a step posts back to its own address, `?change=check` included.
export function selectView(h, { teams, pendingAccess, change, problem = {} }) {
  return h.view('connect/team/select', {
    pageTitle: `${problem.errorSummary ? 'Error: ' : ''}${SELECT_HEADING}`,
    heading: SELECT_HEADING,
    backLink: backHref('select', pendingAccess, change),
    teamItems: buildTeamItems(teams, pendingAccess.teamSlug),
    errorSummary: problem.errorSummary ?? null,
    fieldErrors: problem.fieldErrors ?? {}
  })
}

export function modelStepView(
  h,
  { choices, selected, pendingAccess, change, problem = {} }
) {
  return h.view('connect/team/model', {
    pageTitle: `${problem.errorSummary ? 'Error: ' : ''}${MODEL_HEADING}`,
    heading: MODEL_HEADING,
    teamName: pendingAccess.teamName,
    backLink: backHref('model', pendingAccess, change),
    modelItems: buildModelCheckboxes(choices, selected),
    notInRegionsText: notInRegionsSentence(choices.notInRegionsNames),
    errorSummary: problem.errorSummary ?? null,
    fieldErrors: problem.fieldErrors ?? {}
  })
}

export function detailsView(
  h,
  { pendingAccess, change, values, problem = {} }
) {
  return h.view('connect/team/details', {
    pageTitle: `${problem.errorSummary ? 'Error: ' : ''}${DETAILS_HEADING}`,
    heading: DETAILS_HEADING,
    teamName: pendingAccess.teamName,
    backLink: backHref('details', pendingAccess, change),
    values,
    environmentName: environmentName(
      pendingAccess.environment ?? defaultTeamEnvironment()
    ),
    errorSummary: problem.errorSummary ?? null,
    fieldErrors: problem.fieldErrors ?? {}
  })
}

export async function checkAnswersView(
  request,
  h,
  pendingAccess,
  problem = {}
) {
  const models = await Promise.all(
    pendingAccess.modelSlugs.map((slug) =>
      apiClient(request).get(`/v1/models/${slug}`)
    )
  )

  return h.view('connect/team/check', {
    pageTitle: CHECK_ANSWERS_TITLE,
    heading: CHECK_ANSWERS_TITLE,
    teamName: pendingAccess.teamName,
    backLink: checkBackLink(pendingAccess),
    teamChangeUrl: stepUrl(SELECT_URL, true),
    modelsChangeUrl: stepUrl(MODEL_URL, true),
    purposeChangeUrl: stepUrl(DETAILS_URL, true),
    modelNames: joinNames(models.map(({ displayName }) => displayName)),
    models,
    purpose: pendingAccess.purpose,
    environmentName: environmentName(pendingAccess.environment),
    errorMessage: problem.errorMessage ?? null,
    existingRequestUrl: problem.existingRequestUrl ?? null
  })
}

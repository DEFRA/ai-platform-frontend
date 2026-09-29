import { differenceInCalendarDays } from 'date-fns'

import { apiClient } from '#/server/common/helpers/api-client.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import { formatDate } from '#/config/nunjucks/filters/format-date.js'

const RENEWAL_WARNING_DAYS = 3

async function buildModelNameMap(request) {
  try {
    const { items } = await apiClient(request).get('/v1/models')
    return Object.fromEntries(items.map((model) => [model.slug, model.displayName]))
  } catch {
    return {}
  }
}

function buildExpiringBanner(credentials) {
  const expiring = credentials.find(
    (credential) =>
      credential.tier !== 'team' &&
      credential.status === 'active' &&
      differenceInCalendarDays(new Date(credential.expiresAt), new Date()) <=
        RENEWAL_WARNING_DAYS
  )

  if (!expiring) {
    return null
  }

  return {
    daysLeft: Math.max(
      differenceInCalendarDays(new Date(expiring.expiresAt), new Date()),
      0
    ),
    expiresAtText: formatDate(expiring.expiresAt),
    renewUrl: `/manage/credentials/${expiring._id}`
  }
}

function buildTeamAccess(credentials, teamsById, modelNames) {
  const teamCredential = credentials.find(
    (credential) => credential.tier === 'team' && credential.status === 'active'
  )

  if (!teamCredential) {
    return null
  }

  const modelsText = (teamCredential.allowedDeployments ?? [])
    .map((slug) => modelNames[slug] ?? slug)
    .join(', ')

  return {
    teamName: teamsById.get(teamCredential.teamId)?.name ?? 'Your team',
    modelsText,
    credentialUrl: `/manage/credentials/${teamCredential._id}`
  }
}

/**
 * Home page (`/`) - the shared front door into all three routes to a
 * credential. Public route: signed-out visitors get the marketing/overview
 * content, signed-in visitors get a personalised "Your access" summary.
 */
export const homeController = {
  async handler(request, h) {
    const sessionUser = getSessionUser(request)

    if (!sessionUser) {
      return h.view('home/index', {
        pageTitle: 'Home',
        heading: 'Get AI model access',
        signedIn: false
      })
    }

    // Best-effort: the home page must still render if the backend hiccups.
    let credentials = []
    let teamsList = []
    try {
      ;({ items: credentials } = await apiClient(request).get(
        '/v1/credentials',
        { userId: sessionUser.id }
      ))
      ;({ items: teamsList } = await apiClient(request).get('/v1/teams', {
        userId: sessionUser.id
      }))
    } catch (error) {
      request.logger.warn({ err: error }, 'Could not load access summary for the home page')
    }

    const teamsById = new Map(teamsList.map((team) => [team._id, team]))
    const modelNames = await buildModelNameMap(request)

    return h.view('home/index', {
      pageTitle: 'Home',
      heading: 'Get AI model access',
      signedIn: true,
      expiringBanner: buildExpiringBanner(credentials),
      teamAccess: buildTeamAccess(credentials, teamsById, modelNames)
    })
  }
}

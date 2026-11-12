import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  defaultTeamEnvironment,
  environmentFromAddress,
  environmentPageUrl,
  teamEnvironmentsUrl
} from '#/server/common/helpers/environment-names.js'
import {
  getSessionUser,
  setPendingAccess
} from '#/server/common/helpers/session.js'
import { findTryableModel } from './research-models.js'
import { findChosenTeam } from './team-loaders.js'
import { MODEL_URL } from './team-views.js'

const SLUG = /^[a-z0-9-]+$/

// The model a person came from on a model's page. A badly formed one is
// refused rather than carried into the journey.
const modelSlugField = Joi.string().pattern(SLUG).optional()

const startQuerySchema = Joi.object({
  modelSlug: modelSlugField
}).unknown(false)

// "Deploy a model" from the Environments section names the team (its slug or
// id) and, from an environment's own page, the environment: the journey then
// asks for neither. An environment is only ever named with its team.
const deployQuerySchema = Joi.object({
  modelSlug: modelSlugField,
  teamId: Joi.string().pattern(SLUG),
  environment: Joi.string().pattern(SLUG)
})
  .with('environment', 'teamId')
  .unknown(false)

const startOptions = { validate: { query: startQuerySchema } }
const deployOptions = { validate: { query: deployQuerySchema } }

function notTryableView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Model not available',
      heading: 'Model not available',
      message: 'This model is not available to try on your own yet.',
      actionHref: '/models',
      actionText: 'Browse models'
    })
    .code(statusCodes.notFound)
}

function teamNotFoundView(h) {
  return h
    .view('error/index', {
      pageTitle: 'Team not found',
      heading: 'Team not found',
      message: 'This team does not exist, or you are not a member.',
      actionHref: '/environments',
      actionText: 'Go to your environments'
    })
    .code(statusCodes.notFound)
}

function environmentNotFoundView(h, teamRef) {
  return h
    .view('error/index', {
      pageTitle: 'Environment not found',
      heading: 'Environment not found',
      message: 'This environment does not exist or is not available yet.',
      actionHref: teamEnvironmentsUrl(teamRef),
      actionText: 'Back to all environments'
    })
    .code(statusCodes.notFound)
}

/**
 * The two ways into a journey, from the Models page and a model's page. Each
 * starts a fresh journey (anything left from an earlier one is dropped) and
 * hands over to its first step, skipping the model step when a model is given.
 * Adding to a team also starts from the Environments section, with the team
 * (and the environment) already chosen, which skips the team step.
 */
export const startController = {
  shared: {
    get: {
      options: startOptions,
      async handler(request, h) {
        const { modelSlug } = request.query

        // The backend decides what can be tried on your own, so a model it
        // does not offer is refused here rather than carried into the journey.
        if (modelSlug && !(await findTryableModel(request, modelSlug))) {
          return notTryableView(h)
        }

        setPendingAccess(request, { accessType: 'shared', modelSlug })

        return h.redirect(
          modelSlug ? '/connect/shared/details' : '/connect/shared/model'
        )
      }
    }
  },

  team: {
    get: {
      options: deployOptions,
      async handler(request, h) {
        const {
          modelSlug,
          teamId,
          environment: environmentCode
        } = request.query

        if (!teamId) {
          setPendingAccess(request, { accessType: 'team', modelSlug })

          return h.redirect('/connect/team/select')
        }

        // An environment that is not available is refused before the team is
        // read: there is nothing to start in it.
        const environment = environmentCode
          ? environmentFromAddress(environmentCode)
          : { environment: defaultTeamEnvironment() }

        if (!environment?.environment) {
          return environmentNotFoundView(h, teamId)
        }

        const team = await findChosenTeam(request, teamId)

        if (!team) {
          return teamNotFoundView(h)
        }

        // The journey belongs to this person from here (teamJourneyOf), and
        // remembers the page it came from, which its first steps go back to.
        setPendingAccess(request, {
          accessType: 'team',
          modelSlug,
          teamSlug: team.slug,
          teamName: team.name,
          environment: environment.environment,
          origin: environmentCode
            ? environmentPageUrl(team.slug, environment.environment)
            : teamEnvironmentsUrl(team.slug),
          userId: getSessionUser(request).id
        })

        return h.redirect(MODEL_URL)
      }
    }
  }
}

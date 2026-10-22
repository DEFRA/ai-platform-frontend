import Joi from 'joi'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { setPendingAccess } from '#/server/common/helpers/session.js'
import { findTryableModel } from './research-models.js'

// The model a person came from on a model's page. A badly formed one is
// refused rather than carried into the journey.
const startQuerySchema = Joi.object({
  modelSlug: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .optional()
}).unknown(false)

const startOptions = { validate: { query: startQuerySchema } }

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

/**
 * The two ways into a journey, from the Models page and a model's page. Each
 * starts a fresh journey (anything left from an earlier one is dropped) and
 * hands over to its first step, skipping the model step when a model is given.
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
      options: startOptions,
      handler(request, h) {
        const { modelSlug } = request.query

        setPendingAccess(request, { accessType: 'team', modelSlug })

        return h.redirect('/connect/team/select')
      }
    }
  }
}

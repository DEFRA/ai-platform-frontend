import Joi from 'joi'

import { setPendingAccess } from '#/server/common/helpers/session.js'

// The model a person came from on a model's page. A badly formed one is
// refused rather than carried into the journey.
const startQuerySchema = Joi.object({
  modelSlug: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .optional()
}).unknown(false)

const startOptions = { validate: { query: startQuerySchema } }

/**
 * The two ways into a journey, from the Models page and a model's page. Each
 * starts a fresh journey (anything left from an earlier one is dropped) and
 * hands over to its first step, skipping the model step when a model is given.
 */
export const startController = {
  shared: {
    get: {
      options: startOptions,
      handler(request, h) {
        const { modelSlug } = request.query

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

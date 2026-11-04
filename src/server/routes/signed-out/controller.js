import Joi from 'joi'

import { config } from '#/config/config.js'
import { safeReturnTo } from '#/server/common/helpers/safe-redirect.js'
import { getSessionUser } from '#/server/common/helpers/session.js'

const MS_PER_MINUTE = 60 * 1000
const MINUTES_PER_HOUR = 60

export const signedOutQuerySchema = Joi.object({
  reason: Joi.string().valid('idle', 'expired').optional(),
  returnTo: Joi.string().optional()
}).unknown(false)

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

// "30 minutes", "1 hour", "8 hours": the limit as a person reads it.
function describe(ms) {
  const minutes = Math.round(ms / MS_PER_MINUTE)

  return minutes % MINUTES_PER_HOUR === 0
    ? plural(minutes / MINUTES_PER_HOUR, 'hour')
    : plural(minutes, 'minute')
}

function explanation(reason) {
  if (reason === 'idle') {
    return `For your security, we signed you out because you did not use this service for ${describe(config.get('session.idleTimeoutMs'))}.`
  }

  if (reason === 'expired') {
    return `For your security, we sign you out ${describe(config.get('session.maxAgeMs'))} after you signed in, however much you use the service.`
  }

  return undefined
}

export const signedOutController = {
  options: {
    validate: { query: signedOutQuerySchema }
  },
  handler(request, h) {
    const { reason, returnTo } = request.query
    const safeReturn = returnTo ? safeReturnTo(returnTo, '') : ''

    // The script comes here when time is up by its own clock and it could not
    // ask the server, even though another tab may have kept the session
    // alive. A session that is still live (the global gate has already cleared
    // an ended one) is not signed out: say nothing of it and go back.
    if (getSessionUser(request)) {
      return h.redirect(safeReturn || '/')
    }

    const signInHref = safeReturn
      ? `/sign-in?returnTo=${encodeURIComponent(safeReturn)}`
      : '/sign-in'

    return h.view('signed-out/index', {
      pageTitle: 'You have been signed out',
      heading: 'You have been signed out',
      explanation: explanation(reason),
      signInHref
    })
  }
}

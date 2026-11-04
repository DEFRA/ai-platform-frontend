import { statusCodes } from '../constants/status-codes.js'
import { ApiError } from './api-error.js'
import { getSessionUser, resetSession } from './session.js'

function statusCodeMessage(statusCode) {
  switch (statusCode) {
    case statusCodes.notFound:
      return 'Page not found'
    case statusCodes.forbidden:
      return 'Forbidden'
    case statusCodes.unauthorized:
      return 'Unauthorized'
    case statusCodes.badRequest:
      return 'Bad Request'
    default:
      return 'Something went wrong'
  }
}

// The backend refused the person's token, or none could be had for the call
// (access-token.js): the session is no good, so end it and sign in again. Only
// for someone who had signed in: a visitor's catalogue call failing is an error
// page, not a trip through sign-in.
function endsSession(request, response) {
  return (
    response instanceof ApiError &&
    response.statusCode === statusCodes.unauthorized &&
    getSessionUser(request)
  )
}

function signInAddress(request) {
  if (request.method !== 'get') {
    return '/sign-in'
  }

  const returnTo = `${request.path}${request.url?.search ?? ''}`

  return `/sign-in?returnTo=${encodeURIComponent(returnTo)}`
}

export function catchAll(request, h) {
  const { response } = request

  if (!('isBoom' in response)) {
    return h.continue
  }

  if (endsSession(request, response)) {
    resetSession(request)

    return h.redirect(signInAddress(request))
  }

  const statusCode = response.output.statusCode
  const errorMessage = statusCodeMessage(statusCode)

  if (statusCode >= statusCodes.internalServerError) {
    request.logger.error(response?.stack)
  }

  return h
    .view('error/index', {
      pageTitle: errorMessage,
      heading: statusCode,
      message: errorMessage
    })
    .code(statusCode)
}

import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  environmentFromName,
  environmentSetUpUrl,
  teamEnvironmentsUrl
} from '#/server/common/helpers/environment-names.js'

/**
 * Where the team's environment pages used to be: the set-up page was at
 * `/teams/{slug}/{environment name}` and the Models tab at `/teams/{slug}/models`.
 * Both now belong to the Environments and deployments section, so each answers
 * with a permanent redirect rather than a page of its own.
 */
export const addressRedirects = {
  environmentSetUp: {
    handler(request, h) {
      const { slug, environment: name } = request.params
      const environment = environmentFromName(name)

      if (!environment) {
        return h
          .view('error/index', {
            pageTitle: 'Page not found',
            heading: 'Page not found',
            message: 'This page does not exist.',
            actionHref: teamEnvironmentsUrl(slug),
            actionText: 'Go to environments'
          })
          .code(statusCodes.notFound)
      }

      return h
        .redirect(environmentSetUpUrl(slug, environment.environment))
        .code(statusCodes.movedPermanently)
    }
  },

  modelsTab: {
    handler(request, h) {
      return h
        .redirect(teamEnvironmentsUrl(request.params.slug))
        .code(statusCodes.movedPermanently)
    }
  }
}

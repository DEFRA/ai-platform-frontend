import { RESEARCH_CREDENTIAL_DAYS } from '#/server/common/constants/research-access.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import { loadHomeView } from './home-view.js'

const HEADING = 'Get AI model access'

/**
 * Home page (`/`): the front door. Signed-out visitors get what the service
 * is and the two ways to get access; signed-in people get the two ways in,
 * what needs their attention, their teams and their own keys.
 */
export const homeController = {
  async handler(request, h) {
    if (!getSessionUser(request)) {
      return h.view('home/index', {
        pageTitle: 'Home',
        heading: HEADING,
        signedIn: false,
        researchDays: RESEARCH_CREDENTIAL_DAYS
      })
    }

    return h.view('home/index', {
      pageTitle: 'Home',
      heading: HEADING,
      signedIn: true,
      ...(await loadHomeView(request))
    })
  }
}

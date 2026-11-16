import { getSessionUser } from '#/server/common/helpers/session.js'

function navigationItem(request, text, href) {
  return {
    text,
    href,
    current: request?.path?.startsWith(href) ?? false
  }
}

/**
 * The service navigation: Home, then the model catalogue. Signed in people
 * also see "Personal access", "Teams" and "Environments"; "Signed in as",
 * "Sign out" and "Sign in" are added by the page layout. Home is current on
 * `/` alone, as every address starts with it.
 * @param {object} request the Hapi request
 * @returns {Array<{text: string, href: string, current: boolean}>}
 */
export function buildNavigation(request) {
  const navigation = [
    { text: 'Home', href: '/', current: request?.path === '/' },
    navigationItem(request, 'Model catalogue', '/models')
  ]

  if (getSessionUser(request)) {
    navigation.push(
      navigationItem(request, 'Personal access', '/manage'),
      navigationItem(request, 'Teams', '/teams'),
      navigationItem(request, 'Environments', '/environments')
    )
  }

  navigation.push({
    text: 'Help',
    href: '/about',
    current: request?.path === '/about'
  })

  return navigation
}

import {
  getSessionUser,
  getPendingOidcIdentity
} from '#/server/common/helpers/session.js'

export function buildNavigation(request) {
  const navigation = [
    {
      text: 'Home',
      href: '/',
      current: request?.path === '/'
    }
  ]

  // Shown as soon as Entra ID login succeeds, matching the nav's sign-in/out
  // state, even before the team step (see context.js's navUser) is done.
  if (getSessionUser(request) ?? getPendingOidcIdentity(request)) {
    navigation.push({
      text: 'Connect to model',
      href: '/connect-model',
      current: request?.path?.startsWith('/connect-model')
    })
  }

  // /account requires the full team step, unlike the pending-identity-friendly check above.
  if (getSessionUser(request)) {
    navigation.push({
      text: 'Account',
      href: '/account',
      current: request?.path?.startsWith('/account')
    })
  }

  navigation.push({
    text: 'About',
    href: '/about',
    current: request?.path === '/about'
  })

  return navigation
}

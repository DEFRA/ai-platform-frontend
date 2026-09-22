import { getSessionUser } from '#/server/common/helpers/session.js'

export function buildNavigation(request) {
  const navigation = [
    {
      text: 'Home',
      href: '/',
      current: request?.path === '/'
    },
    {
      text: 'Browse models',
      href: '/models',
      current: request?.path?.startsWith('/models')
    }
  ]

  navigation.push({
    text: 'Connect to a model',
    href: '/connect',
    current: request?.path?.startsWith('/connect')
  })

  if (getSessionUser(request)) {
    navigation.push({
      text: 'Manage AI access',
      href: '/manage',
      current: request?.path?.startsWith('/manage')
    })
  }

  navigation.push({
    text: 'About',
    href: '/about',
    current: request?.path === '/about'
  })

  return navigation
}

import { getSessionUser } from '#/server/common/helpers/session.js'

export function buildNavigation(request) {
  const navigation = [
    {
      text: 'Home',
      href: '/',
      current: request?.path === '/'
    },
    {
      text: 'Models',
      href: '/models',
      current: request?.path?.startsWith('/models')
    }
  ]

  if (getSessionUser(request)) {
    navigation.push({
      text: 'Your access',
      href: '/manage',
      current: request?.path?.startsWith('/manage')
    })
  }

  navigation.push({
    text: 'Help',
    href: '/about',
    current: request?.path === '/about'
  })

  return navigation
}

export function buildNavigation(request) {
  return [
    {
      text: 'Home',
      href: '/',
      current: request?.path === '/'
    },
    {
      text: 'Connect to model',
      href: '/connect-model',
      current: request?.path?.startsWith('/connect-model')
    },
    {
      text: 'About',
      href: '/about',
      current: request?.path === '/about'
    }
  ]
}

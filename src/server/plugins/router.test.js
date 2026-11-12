import Hapi from '@hapi/hapi'

import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { router } from './router.js'

// The real Hapi server, plugins, Vite and the connect bridge: nothing here is
// faked, so what is checked is what a developer's server does.
function pathsOf(server) {
  return server.table().map(({ path }) => path)
}

describe('#router', () => {
  const isTest = config.get('isTest')
  const isProduction = config.get('isProduction')
  let server

  beforeEach(() => {
    server = Hapi.server()
  })

  afterEach(async () => {
    config.set('isTest', isTest)
    config.set('isProduction', isProduction)
    await server.stop({ timeout: 0 })
  })

  test('registers the health check and the routes of every section, the Environments section among them', async () => {
    await server.register(router)

    expect(pathsOf(server)).toEqual(
      expect.arrayContaining([
        '/health',
        '/models',
        '/manage',
        '/teams',
        '/environments',
        '/environments/{slug}/{environment}/limits'
      ])
    )
  })

  test.each([
    ['in test', { isTest: true, isProduction: false }],
    ['in production', { isTest: false, isProduction: true }]
  ])('serves the built assets %s, without Vite', async (_name, flags) => {
    config.set('isTest', flags.isTest)
    config.set('isProduction', flags.isProduction)

    await server.register(router)

    expect(pathsOf(server)).toContain('/public/{param*}')
  })

  test('serves assets from Vite through the connect bridge in development, and closes Vite when the server stops', async () => {
    config.set('isTest', false)
    config.set('isProduction', false)

    await server.register(router)
    await server.initialize()

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/public/@vite/client',
      headers: { host: 'localhost:3000' }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['content-type']).toContain('javascript')

    await expect(server.stop({ timeout: 0 })).resolves.toBeUndefined()
  }, 60000)
})

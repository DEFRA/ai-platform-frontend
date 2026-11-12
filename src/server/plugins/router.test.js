import { router } from './router.js'
import { serveStaticFiles } from './serve-static-files.js'

const flags = vi.hoisted(() => ({ isProduction: false, isTest: false }))
const createViteServer = vi.hoisted(() =>
  vi.fn(async () => ({ middlewares: 'vite-middlewares' }))
)

vi.mock('#/config/config.js', async (importOriginal) => {
  const { config } = await importOriginal()

  return {
    config: {
      get: (key) => (key in flags ? flags[key] : config.get(key))
    }
  }
})

// Vite and the connect bridge are only for local development.
vi.mock('vite', () => ({ createServer: createViteServer }))
vi.mock('@defra/hapi-connect', () => ({ default: { name: 'hapi-connect' } }))

function fakeServer() {
  return { register: vi.fn(async () => undefined) }
}

function registered(server) {
  return server.register.mock.calls.map(([plugins]) => plugins)
}

describe('#router', () => {
  beforeEach(() => {
    flags.isProduction = false
    flags.isTest = false
  })

  test('registers the health check and every route plugin, the Environments section among them', async () => {
    const server = fakeServer()

    flags.isTest = true
    await router.plugin.register(server)

    const names = registered(server)
      .flat()
      .map((plugin) => plugin.plugin?.name ?? plugin.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'health',
        'home',
        'models',
        'connect-routes',
        'manage',
        'teams',
        'environments'
      ])
    )
  })

  test('serves the built assets in test and in production, without Vite', async () => {
    for (const mode of ['isTest', 'isProduction']) {
      const server = fakeServer()

      flags.isTest = mode === 'isTest'
      flags.isProduction = mode === 'isProduction'
      await router.plugin.register(server)

      expect(server.register).toHaveBeenLastCalledWith(serveStaticFiles)
    }

    expect(createViteServer).not.toHaveBeenCalled()
  })

  test('serves assets from Vite, through the connect bridge, in development', async () => {
    const server = fakeServer()

    await router.plugin.register(server)

    expect(createViteServer).toHaveBeenCalledWith({
      server: { middlewareMode: true },
      appType: 'custom'
    })
    expect(server.register).toHaveBeenLastCalledWith({
      plugin: { name: 'hapi-connect' },
      options: { path: '/public', middleware: ['vite-middlewares'] }
    })
  })
})

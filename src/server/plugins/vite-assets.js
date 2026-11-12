/**
 * Serves the page's scripts and styles from Vite while developing locally: Vite
 * runs in middleware mode and `@defra/hapi-connect` hands it the requests under
 * `/public`. Never used in production or in tests, which serve the built files.
 * Vite is closed when the server stops.
 * @param {import('@hapi/hapi').Server} server
 * @returns {Promise<void>}
 */
export async function registerViteAssets(server) {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom'
  })

  server.ext('onPostStop', () => vite.close())

  await server.register({
    plugin: (await import('@defra/hapi-connect')).default,
    options: {
      path: '/public',
      middleware: [vite.middlewares]
    }
  })
}

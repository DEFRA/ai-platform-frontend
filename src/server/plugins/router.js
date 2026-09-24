import inert from '@hapi/inert'

import { home } from '../routes/home/index.js'
import { about } from '../routes/about/index.js'
import { health } from '../routes/health/index.js'
import { signIn } from '../routes/sign-in/index.js'
import { signOut } from '../routes/sign-out/index.js'
import { auth } from '../routes/auth/index.js'
import { models } from '../routes/models/index.js'
import { connect } from '../routes/connect/index.js'
import { manage } from '../routes/manage/index.js'
import { teams } from '../routes/teams/index.js'
import { serveStaticFiles } from './serve-static-files.js'
import { config } from '#/config/config.js'

export const router = {
  plugin: {
    name: 'router',
    async register(server) {
      await server.register([inert])

      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      // Application specific routes, add your own routes here
      await server.register([
        home,
        about,
        signIn,
        signOut,
        auth,
        models,
        connect,
        manage,
        teams
      ])

      // Static assets
      if (!config.get('isProduction') && !config.get('isTest')) {
        await (async () => {
          const createViteServer = (await import('vite')).createServer
          const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'custom'
          })

          await server.register({
            plugin: (await import('@defra/hapi-connect')).default,
            options: {
              path: '/public',
              middleware: [vite.middlewares]
            }
          })
        })()
      } else {
        server.register(serveStaticFiles)
      }
    }
  }
}

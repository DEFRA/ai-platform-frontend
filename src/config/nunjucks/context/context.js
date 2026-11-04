import path from 'node:path'
import { readFileSync } from 'node:fs'

import { config } from '#/config/config.js'
import { buildNavigation } from './build-navigation.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { getSessionUser } from '#/server/common/helpers/session.js'
import { sessionTimes } from '#/server/common/helpers/session-lifetime.js'

const logger = createLogger()
const assetPath = config.get('assetPath')
const manifestPath = path.join(
  config.get('root'),
  '.public/.vite/manifest.json'
)

let viteManifest

export function context(request) {
  if (config.get('isProduction') && !viteManifest) {
    try {
      viteManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (error) {
      logger.error(`Vite ${path.basename(manifestPath)} not found`)
    }
  }

  const signedInUser = getSessionUser(request)

  return {
    assetPath: `${assetPath}/assets`,
    serviceName: config.get('serviceName'),
    serviceUrl: '/',
    breadcrumbs: [],
    currentPath: request?.path,
    navigation: buildNavigation(request),
    signedInUser,
    navUser: signedInUser,
    // The time left on each session limit, for the timeout warning; only a
    // signed-in session has one.
    sessionTimeout: signedInUser ? sessionTimes(request) : undefined,
    getAssetPath(asset) {
      if (!config.get('isProduction')) {
        return `${assetPath}/${asset}`
      }

      const viteAssetPath = viteManifest?.[asset]?.file
      return `${assetPath}/${viteAssetPath ?? asset}`
    }
  }
}

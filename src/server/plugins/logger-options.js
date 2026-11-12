import { ecsFormat } from '@elastic/ecs-pino-format'
import { getTraceId } from '@defra/hapi-tracing'

import { config } from '#/config/config.js'

const logConfig = config.get('log')
const serviceName = config.get('serviceName')
const serviceVersion = config.get('serviceVersion')

const formatters = {
  ecs: {
    ...ecsFormat({
      serviceVersion,
      serviceName
    })
  },
  'pino-pretty': { transport: { target: 'pino-pretty' } }
}

// What a person types to search (the admin Teams list, the people search) can
// name a person, so it is never logged, whatever LOG_REDACT holds (AC18).
const alwaysRedacted = ['req.query.search']

export const loggerOptions = {
  enabled: logConfig.enabled,
  ignorePaths: ['/health'],
  redact: {
    paths: [...new Set([...logConfig.redact, ...alwaysRedacted])],
    remove: true
  },
  level: logConfig.level,
  ...formatters[logConfig.format],
  nesting: true,
  mixin() {
    const mixinValues = {}
    const traceId = getTraceId()
    if (traceId) {
      mixinValues.trace = { id: traceId }
    }
    return mixinValues
  }
}

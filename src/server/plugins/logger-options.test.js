import Hapi from '@hapi/hapi'
import hapiPino from 'hapi-pino'
import { ecsFormat } from '@elastic/ecs-pino-format'

import { loggerOptions } from './logger-options.js'

// Runs the service's real log redaction over a real request and returns what
// the request log would hold, as text.
async function requestLog(url) {
  const lines = []
  const server = Hapi.server()

  await server.register({
    plugin: hapiPino,
    options: {
      ...ecsFormat(),
      redact: loggerOptions.redact,
      level: 'info',
      stream: { write: (line) => lines.push(line) }
    }
  })
  server.route({ method: 'GET', path: '/{path*}', handler: () => 'ok' })

  await server.inject({ method: 'GET', url })

  return lines.join('')
}

describe('#loggerOptions redaction', () => {
  test('Should not log the search text of an admin Teams search', async () => {
    const log = await requestLog('/admin/teams?search=zzzz&status=active')

    expect(log).toContain('/admin/teams')
    expect(log).not.toContain('zzzz')
  })

  test('Should not log the search text of a people search', async () => {
    const log = await requestLog('/teams/t1/members/add/search?search=amelia')

    expect(log).not.toContain('amelia')
  })

  test('Should not log the person text of an audit log filter', async () => {
    const log = await requestLog(
      '/admin/audit?person=jo&environment=infradev&team=team-1'
    )

    expect(log).toContain('/admin/audit')
    expect(log).not.toContain('"person"')
    expect(log).not.toContain('"jo"')
  })

  test('Should still log the other filters of the audit log', async () => {
    const log = await requestLog('/admin/audit?person=jo&environment=infradev')

    expect(log).toContain('infradev')
  })

  test('Should still log the other parts of the query', async () => {
    const log = await requestLog('/admin/teams?search=zzzz&status=active')

    expect(log).toContain('active')
  })
})

import { vi } from 'vitest'

import hapi from '@hapi/hapi'
import { statusCodes } from '../constants/status-codes.js'
import * as createServerImport from '../../server.js'
import { startServer } from './start-server.js'

// The configuration reads the port when it is first imported, so this is set
// before the imports above, which are loaded with the file. Importing the
// whole server inside `beforeAll` put its load time (seconds, and more with
// coverage and many test files at once) inside the hook's 30 second limit.
vi.hoisted(() => vi.stubEnv('PORT', '3097'))

describe('#startServer', () => {
  let createServerSpy
  let hapiServerSpy

  beforeAll(() => {
    createServerSpy = vi.spyOn(createServerImport, 'createServer')
    hapiServerSpy = vi.spyOn(hapi, 'server')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  describe('When server starts', () => {
    let server

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('Should start up server as expected', async () => {
      server = await startServer()

      expect(createServerSpy).toHaveBeenCalled()
      expect(hapiServerSpy).toHaveBeenCalled()

      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: '/health'
      })

      expect(result).toEqual({ message: 'success' })
      expect(statusCode).toBe(statusCodes.ok)
    })
  })

  describe('When server start fails', () => {
    test('Should log failed startup message', async () => {
      createServerSpy.mockRejectedValue(new Error('Server failed to start'))

      await expect(startServer()).rejects.toThrow('Server failed to start')
    })
  })
})

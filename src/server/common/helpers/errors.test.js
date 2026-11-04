import { vi } from 'vitest'
import Boom from '@hapi/boom'

import { catchAll } from './errors.js'
import { ApiError } from './api-error.js'
import { createServer } from '../../server.js'
import { statusCodes } from '../constants/status-codes.js'

describe('#errors', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should provide expected Not Found page', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/non-existent-path'
    })

    expect(result).toEqual(
      expect.stringContaining('Page not found | AI Platform Portal')
    )
    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('#catchAll an API call the backend refused as unauthorised', () => {
  const boomified = (statusCode = statusCodes.unauthorized) =>
    Boom.boomify(new ApiError({ statusCode, code: 'invalid-token' }))
  const signedInRequest = (overrides = {}) => ({
    response: boomified(),
    path: '/manage',
    method: 'get',
    url: { search: '?tab=models' },
    yar: { get: () => ({ id: 'user-1' }), reset: vi.fn() },
    logger: { error: vi.fn() },
    ...overrides
  })
  const toolkit = () => ({
    redirect: vi.fn(() => 'redirected'),
    view: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis()
  })

  test('ends the session and sends a signed-in person to sign in, back to the page they wanted', () => {
    const request = signedInRequest()
    const h = toolkit()

    expect(catchAll(request, h)).toBe('redirected')

    expect(request.yar.reset).toHaveBeenCalledTimes(1)
    expect(h.redirect).toHaveBeenCalledWith(
      '/sign-in?returnTo=%2Fmanage%3Ftab%3Dmodels'
    )
  })

  test('has no page to come back to after a POST', () => {
    const h = toolkit()

    catchAll(signedInRequest({ method: 'post' }), h)

    expect(h.redirect).toHaveBeenCalledWith('/sign-in')
  })

  test('shows the error page, and does not sign in again, for a visitor who had not signed in', () => {
    const request = signedInRequest({ yar: { get: () => undefined } })
    const h = toolkit()

    catchAll(request, h)

    expect(h.redirect).not.toHaveBeenCalled()
    expect(h.view).toHaveBeenCalledWith(
      'error/index',
      expect.objectContaining({ message: 'Something went wrong' })
    )
  })

  test('does not treat any other failed call as an ended session', () => {
    const request = signedInRequest({
      response: Boom.boomify(
        new ApiError({ statusCode: statusCodes.forbidden, code: 'forbidden' })
      )
    })
    const h = toolkit()

    catchAll(request, h)

    expect(request.yar.reset).not.toHaveBeenCalled()
    expect(h.redirect).not.toHaveBeenCalled()
  })

  test('works for the error a thrown handler really makes', async () => {
    const server = await createServer()
    server.route({
      method: 'GET',
      path: '/test-unauthorised',
      options: { app: { public: true } },
      handler() {
        throw new ApiError({ statusCode: 401, code: 'invalid-token' })
      }
    })
    await server.initialize()

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/test-unauthorised'
    })
    await server.stop({ timeout: 0 })

    // Signed out: the error page, not a loop through sign-in.
    expect(statusCode).toBe(statusCodes.internalServerError)
  })
})

describe('#catchAll', () => {
  const mockErrorLogger = vi.fn()
  const mockStack = 'Mock error stack'
  const errorPage = 'error/index'
  const mockRequest = (statusCode) => ({
    response: {
      isBoom: true,
      stack: mockStack,
      output: {
        statusCode
      }
    },
    logger: { error: mockErrorLogger }
  })
  const mockToolkitView = vi.fn()
  const mockToolkitCode = vi.fn()
  const mockToolkit = {
    view: mockToolkitView.mockReturnThis(),
    code: mockToolkitCode.mockReturnThis()
  }

  test('Should provide expected "Not Found" page', () => {
    catchAll(mockRequest(statusCodes.notFound), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Page not found',
      heading: statusCodes.notFound,
      message: 'Page not found'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.notFound)
  })

  test('Should provide expected "Forbidden" page', () => {
    catchAll(mockRequest(statusCodes.forbidden), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Forbidden',
      heading: statusCodes.forbidden,
      message: 'Forbidden'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.forbidden)
  })

  test('Should provide expected "Unauthorized" page', () => {
    catchAll(mockRequest(statusCodes.unauthorized), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Unauthorized',
      heading: statusCodes.unauthorized,
      message: 'Unauthorized'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.unauthorized)
  })

  test('Should provide expected "Bad Request" page', () => {
    catchAll(mockRequest(statusCodes.badRequest), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Bad Request',
      heading: statusCodes.badRequest,
      message: 'Bad Request'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.badRequest)
  })

  test('Should provide expected default page', () => {
    catchAll(mockRequest(statusCodes.imATeapot), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Something went wrong',
      heading: statusCodes.imATeapot,
      message: 'Something went wrong'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCodes.imATeapot)
  })

  test('Should provide expected "Something went wrong" page and log error for internalServerError', () => {
    catchAll(mockRequest(statusCodes.internalServerError), mockToolkit)

    expect(mockErrorLogger).toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Something went wrong',
      heading: statusCodes.internalServerError,
      message: 'Something went wrong'
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(
      statusCodes.internalServerError
    )
  })
})

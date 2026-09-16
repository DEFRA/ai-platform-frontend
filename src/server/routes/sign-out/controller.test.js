import { createServer } from '#/server/server.js'

function extractCookie(response, name) {
  const setCookie = response.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const match = cookies.find((cookie) => cookie?.startsWith(`${name}=`))

  return match?.split(';')[0].split('=').slice(1).join('=')
}

describe('#signOutController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('POST /sign-out clears the session and redirects to /', async () => {
    const getResponse = await server.inject({ method: 'GET', url: '/' })
    const crumb = extractCookie(getResponse, 'crumb')

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/sign-out',
      headers: { cookie: `crumb=${crumb}` },
      payload: { crumb }
    })

    expect(statusCode).toBe(303)
    expect(headers.location).toBe('/')
  })
})

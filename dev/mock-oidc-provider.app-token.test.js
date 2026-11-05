import net from 'node:net'

import { config } from '#/config/config.js'
import {
  getAppToken,
  resetAppToken
} from '#/server/common/helpers/access-token.js'
import { resetOidcConfig } from '#/server/common/helpers/oidc-client.js'

import { createMockProvider, settingsFromEnv } from './mock-oidc-provider.js'

// The test setup replaces getAppToken for every other file.
vi.unmock('#/server/common/helpers/access-token.js')

const TENANT = '55555555-5555-4555-8555-555555555555'
const CLIENT = '33333333-3333-4333-8333-333333333333'
const API = '44444444-4444-4444-8444-444444444444'
const SECRET = 'mock-secret'

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

const claimsOf = (token) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url'))

// The real frontend client (openid-client through oidc-client.js and
// access-token.js) against the bundled mock provider, nothing in between:
// what a developer's `npm run dev` does for the catalogue's reads.
describe('#the frontend app token from the bundled mock OIDC provider', () => {
  let server
  let issuer

  beforeAll(async () => {
    const port = await freePort()
    const settings = settingsFromEnv({
      MOCK_OIDC_PORT: String(port),
      AZURE_TENANT_ID: TENANT,
      AZURE_CLIENT_ID: CLIENT,
      AZURE_CLIENT_SECRET: SECRET,
      AZURE_API_CLIENT_ID: API
    })

    issuer = settings.issuer
    server = await new Promise((resolve) => {
      const listening = createMockProvider(settings).listen(port, () =>
        resolve(listening)
      )
    })
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(() => {
    vi.spyOn(config, 'get').mockImplementation(
      (key) =>
        ({
          'azureAd.mockIssuerUrl': issuer,
          'azureAd.tenantId': TENANT,
          'azureAd.clientId': CLIENT,
          'azureAd.apiClientId': API,
          'azureAd.clientSecret': SECRET,
          'azureAd.authMethod': 'client-secret'
        })[key] ?? config.default(key)
    )
    resetOidcConfig()
    resetAppToken()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('getAppToken() gets an app-only token for the API, in the configured tenant', async () => {
    const token = await getAppToken()

    expect(claimsOf(token)).toMatchObject({
      iss: issuer,
      aud: API,
      tid: TENANT,
      idtyp: 'app',
      azp: CLIENT
    })
  })
})

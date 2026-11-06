// The network behind Entra ID sign-in, for tests that use the real
// openid-client and the real CDP Web Identity provider (@defra/hapi-auth-oidc,
// which asks AWS STS for the client assertion): nothing is replaced in the
// code, only what answers over the wire. Testing standards 2.4.1 and 2.4.2.
import nock from 'nock'

export const LOGIN_HOST = 'https://login.microsoftonline.com'
export const TENANT = 'tenant-123'
export const CLIENT_ID = 'client-123'
export const CLIENT_SECRET = 'secret-123'
export const API_CLIENT_ID = '44444444-4444-4444-8444-444444444444'

const AWS_REGION = 'eu-west-2'
const STS_HOST = `https://sts.${AWS_REGION}.amazonaws.com`
const TOKEN_PATH = `/${TENANT}/oauth2/v2.0/token`

export const DISCOVERY_PATH = `/${TENANT}/v2.0/.well-known/openid-configuration`

function formBody(body) {
  return typeof body === 'string'
    ? Object.fromEntries(new URLSearchParams(body))
    : body
}

// Answers each request in turn with the next answer, and keeps what was asked
// (the body matcher is the one place nock hands over the request body).
function interceptInOrder(host, path, answers) {
  const requests = []
  const scope = nock(host)

  for (const [status, body] of answers) {
    scope
      .post(path, (sent) => {
        requests.push(formBody(sent))

        return true
      })
      .reply(status, body)
  }

  return { requests, scope }
}

/**
 * What Entra publishes about itself for a tenant.
 * @param {string} [issuer]
 */
export function entraMetadata(issuer = `${LOGIN_HOST}/${TENANT}/v2.0`) {
  return {
    issuer,
    authorization_endpoint: `${LOGIN_HOST}/${TENANT}/oauth2/v2.0/authorize`,
    token_endpoint: `${LOGIN_HOST}${TOKEN_PATH}`,
    end_session_endpoint: `${LOGIN_HOST}/${TENANT}/oauth2/v2.0/logout`,
    jwks_uri: `${LOGIN_HOST}/${TENANT}/discovery/v2.0/keys`
  }
}

/**
 * Answers the discovery request, or fails it. Every request is kept.
 * @param {{ host?: string, path?: string, answer?: [number, object] }} [options]
 */
export function interceptDiscovery({
  host = LOGIN_HOST,
  path = DISCOVERY_PATH,
  answer = [200, entraMetadata()]
} = {}) {
  const requests = []
  const scope = nock(host)
    .get(path)
    .reply(() => {
      requests.push(path)

      return answer
    })

  return { requests, scope }
}

/**
 * What the token endpoint gives for a grant.
 */
export function tokenResponse(overrides = {}) {
  return [
    200,
    {
      token_type: 'Bearer',
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 3600,
      ...overrides
    }
  ]
}

/**
 * Answers token requests in order, keeping the form each one sent.
 * @param {...[number, object]} answers a status and a body for each request
 */
export function interceptTokenEndpoint(...answers) {
  return interceptInOrder(LOGIN_HOST, TOKEN_PATH, answers)
}

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/**
 * A JWT as CDP Web Identity gives for the client assertion. Only its times are
 * read by the provider (to know when to ask again); Entra checks the rest.
 * @param {{ expiresAt: number, subject?: string }} claims `expiresAt` in ms
 */
export function webIdentityToken({ expiresAt, subject = 'cdp-frontend' }) {
  const claims = { sub: subject, exp: Math.floor(expiresAt / 1000) }

  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.signature`
}

function webIdentityAnswer(token) {
  return [
    200,
    `<GetWebIdentityTokenResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetWebIdentityTokenResult><WebIdentityToken>${token}</WebIdentityToken><Expiration>2099-01-01T00:00:00Z</Expiration></GetWebIdentityTokenResult><ResponseMetadata><RequestId>request-1</RequestId></ResponseMetadata></GetWebIdentityTokenResponse>`
  ]
}

/** An STS answer that gives the token. */
export const webIdentityGives = webIdentityAnswer

/** An STS answer that refuses (not retried by the AWS client). */
export function webIdentityRefuses() {
  return [
    403,
    '<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type><Code>AccessDenied</Code><Message>Not allowed</Message></Error><RequestId>request-1</RequestId></ErrorResponse>'
  ]
}

/**
 * Answers the requests for a Web Identity token in order, keeping the form
 * each one sent.
 * @param {...[number, string]} answers from `webIdentityGives` or `webIdentityRefuses`
 */
export function interceptWebIdentity(...answers) {
  return interceptInOrder(STS_HOST, '/', answers)
}

/**
 * Credentials for the AWS client that asks STS, as CDP gives the container.
 * Call `vi.unstubAllEnvs()` afterwards.
 */
export function stubAwsCredentials() {
  vi.stubEnv('AWS_REGION', AWS_REGION)
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-access-key')
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret-key')
  vi.stubEnv('AWS_SESSION_TOKEN', 'test-session-token')
  vi.stubEnv('AWS_CREDENTIAL_EXPIRATION', '2099-01-01T00:00:00Z')
}

/**
 * Stops anything leaving the machine in a test, and clears what is left over.
 * Call from `beforeAll`; pair `afterAll` with `endNetworkBlock`.
 */
export function blockNetwork() {
  nock.disableNetConnect()
}

export function endNetworkBlock() {
  nock.cleanAll()
  nock.enableNetConnect()
}

/** Clears interceptors that were never used, between tests. */
export function clearInterceptors() {
  nock.cleanAll()
}

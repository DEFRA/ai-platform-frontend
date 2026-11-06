import { config } from '#/config/config.js'
import { appScope, userScope } from './portal-scopes.js'

const API = '44444444-4444-4444-8444-444444444444'

describe('#portal scopes', () => {
  beforeEach(() => {
    vi.spyOn(config, 'get').mockImplementation((key) =>
      key === 'azureAd.apiClientId' ? API : config.default(key)
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('a person signs in for the OpenID scopes, offline access and the API scope Portal.Access', () => {
    expect(userScope().split(' ')).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      `api://${API}/Portal.Access`
    ])
  })

  test("the frontend's own token is for the API's default scope", () => {
    expect(appScope()).toBe(`api://${API}/.default`)
  })
})

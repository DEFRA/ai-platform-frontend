import {
  buildApplications,
  buildConnection,
  environmentHasRoom
} from '#/server/routes/environments/federation-view.js'

const team = { slug: 'flood-risk-team', name: 'Flood Risk Team' }

function application(overrides = {}) {
  return {
    id: 'app-1',
    name: 'flood-api',
    host: 'cdp',
    service: 'flood-api',
    status: 'ready',
    operationId: 'op-1',
    failureReason: null,
    ...overrides
  }
}

function detail(items, used = items.length) {
  return { setUp: true, applications: { used, limit: 20, items } }
}

function applications(items, options = {}) {
  return buildApplications({
    team,
    environment: 'infradev',
    registryName: 'Infradev',
    detail: detail(items, options.used),
    isAdmin: options.isAdmin ?? true
  })
}

describe('#buildApplications', () => {
  test('is nothing for an environment that is not set up', () => {
    expect(
      buildApplications({
        team,
        environment: 'qa',
        registryName: 'QA',
        detail: { setUp: false, applications: { used: 0, limit: 20 } },
        isAdmin: true
      })
    ).toBeNull()
  })

  test('is nothing when the backend gave no applications', () => {
    expect(
      buildApplications({
        team,
        environment: 'infradev',
        registryName: 'Infradev',
        detail: { setUp: true },
        isAdmin: true
      })
    ).toBeNull()
  })

  test('counts the applications used out of the limit and links to Federate while there is room', () => {
    const view = applications([application()], { used: 3 })

    expect(view.countText).toBe('3 of 20 used')
    expect(view.full).toBe(false)
    expect(view.federateUrl).toBe(
      '/environments/flood-risk-team/federate?environment=infradev'
    )
  })

  test('says why a full registration offers no Federate link', () => {
    const view = applications([application()], { used: 20 })

    expect(view.full).toBe(true)
    expect(view.federateUrl).toBeNull()
    expect(view.fullMessage).toBe(
      'Infradev holds 20 applications, the most one environment can. Remove one to federate another here.'
    )
  })

  test('has no full message while there is room', () => {
    expect(applications([application()]).fullMessage).toBeNull()
  })

  test('names where each application runs and tags its state', () => {
    const view = applications([
      application(),
      application({
        id: 'app-2',
        name: 'flood-reports',
        host: 'azure',
        service: undefined,
        principalId: '11111111-1111-4111-8111-111111111111',
        status: 'setting-up'
      }),
      application({ id: 'app-3', name: 'old', status: 'removing' })
    ])

    expect(view.items.map((item) => item.kind)).toEqual([
      'CDP service',
      'Azure managed identity',
      'CDP service'
    ])
    expect(view.items.map((item) => item.tag.text)).toEqual([
      'Ready to use',
      'Setting up',
      'Removing'
    ])
    expect(view.items[0].tag.tagClass).toBe('govuk-tag--green')
    expect(view.items[1].tag.tagClass).toBe('govuk-tag--yellow')
  })

  test('gives an admin Change and Remove for a ready application', () => {
    const [item] = applications([application()]).items

    expect(item.changeUrl).toBe(
      '/environments/flood-risk-team/infradev/applications/app-1/change'
    )
    expect(item.removeUrl).toBe(
      '/environments/flood-risk-team/infradev/applications/app-1/remove'
    )
  })

  test('gives a Member no action at all', () => {
    const [item] = applications([application()], { isAdmin: false }).items

    expect(item.changeUrl).toBeNull()
    expect(item.removeUrl).toBeNull()
  })

  test('gives an admin no action while an application is being set up or removed', () => {
    const items = applications([
      application({ id: 'a', status: 'setting-up' }),
      application({ id: 'b', status: 'removing' })
    ]).items

    expect(items.every((item) => !item.changeUrl && !item.removeUrl)).toBe(true)
  })

  test('shows why a failed application failed and lets an admin remove it, not change it', () => {
    const [item] = applications([
      application({
        status: 'failed',
        failureReason: 'The platform checks refused the change.'
      })
    ]).items

    expect(item.tag).toEqual({ text: 'Failed', tagClass: 'govuk-tag--red' })
    expect(item.reason).toBe('The platform checks refused the change.')
    expect(item.changeUrl).toBeNull()
    expect(item.removeUrl).toContain('/remove')
  })

  test('shows no reason for an application that did not fail', () => {
    expect(applications([application()]).items[0].reason).toBeNull()
  })

  test('shows a state it does not know as a grey tag with its own words', () => {
    const [item] = applications([application({ status: 'paused' })]).items

    expect(item.tag).toEqual({ text: 'paused', tagClass: 'govuk-tag--grey' })
  })
})

describe('#environmentHasRoom', () => {
  test('is true for a set-up environment holding fewer applications than its limit', () => {
    expect(
      environmentHasRoom({
        setUp: true,
        applications: { used: 19, limit: 20 }
      })
    ).toBe(true)
  })

  test.each([
    ['full', { setUp: true, applications: { used: 20, limit: 20 } }],
    ['not set up', { setUp: false, applications: { used: 0, limit: 20 } }],
    ['without a count', { setUp: true }],
    ['missing', undefined]
  ])('is false for one that is %s', (_name, summary) => {
    expect(environmentHasRoom(summary)).toBe(false)
  })
})

describe('#buildConnection', () => {
  const connection = {
    placeholder: true,
    gatewayUrl: 'https://gateway.example/flood-risk-team',
    tokenEndpoint:
      'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/oauth2/v2.0/token',
    clientId: '00000000-0000-0000-0000-000000000001',
    tenantId: '00000000-0000-0000-0000-000000000000',
    scope: 'api://00000000-0000-0000-0000-000000000002/.default',
    cdpAudience: 'api://AzureADTokenExchange'
  }

  function build(overrides = {}) {
    return buildConnection({
      detail: {
        connection,
        models: [
          { modelSlug: 'gpt-4o', status: 'active' },
          { modelSlug: 'gpt-5', status: 'deploying' }
        ]
      },
      catalogue: { 'gpt-4o': { apiProfile: 'chat-completions' } },
      ...overrides
    })
  }

  test('is nothing when the backend has no connection details', () => {
    expect(build({ detail: { connection: null, models: [] } })).toBeNull()
  })

  test('lists each value with an id for its Copy button, and the first call', () => {
    const view = build()

    expect(view.rows.map((row) => [row.key, row.value])).toEqual([
      ['Gateway address', connection.gatewayUrl],
      ['Token endpoint', connection.tokenEndpoint],
      ['Client ID', connection.clientId],
      ['Tenant ID', connection.tenantId],
      ['Scope', connection.scope],
      ['Audience', connection.cdpAudience],
      ['First test call', 'GET https://gateway.example/flood-risk-team/whoami']
    ])
    expect(new Set(view.rows.map((row) => row.id)).size).toBe(7)
    expect(view.rows[5].hint).toBe('For a CDP token')
  })

  test('says the values are examples while the backend flags them a placeholder', () => {
    expect(build().placeholder).toBe(true)
    expect(
      build({
        detail: {
          connection: { ...connection, placeholder: false },
          models: []
        }
      }).placeholder
    ).toBe(false)
  })

  test('shows the token request with the values filled in', () => {
    const { token } = build()

    expect(token.audience).toBe('api://AzureADTokenExchange')
    expect(token.request).toContain(`POST ${connection.tokenEndpoint}`)
    expect(token.request).toContain(`client_id=${connection.clientId}`)
    expect(token.request).toContain(`scope=${connection.scope}`)
    expect(token.request).toContain('grant_type=client_credentials')
  })

  test('shows the first call as GET on the gateway’s whoami', () => {
    expect(build().token.whoami).toBe(
      'GET https://gateway.example/flood-risk-team/whoami\nAuthorization: Bearer <access token>'
    )
  })

  test('shows a chat completions call for the first ready model, with no key and no api-version', () => {
    const { token } = build()

    expect(token.model).toContain(
      'POST https://gateway.example/flood-risk-team/openai/v1/chat/completions'
    )
    expect(token.model).toContain('Authorization: Bearer <access token>')
    expect(token.model).toContain('"model": "gpt-4o"')
    expect(token.model).toContain('"messages"')
    expect(token.model).not.toContain('api-version')
    expect(token.model).not.toContain('Ocp-Apim-Subscription-Key')
  })

  test('shows a responses call for a model whose apiProfile is responses', () => {
    const { token } = build({
      catalogue: { 'gpt-4o': { apiProfile: 'responses' } }
    })

    expect(token.model).toContain(
      'POST https://gateway.example/flood-risk-team/openai/v1/responses'
    )
    expect(token.model).toContain('"input"')
  })

  test('asks for a model name when the team has no ready model yet', () => {
    const { token } = build({
      detail: {
        connection,
        models: [{ modelSlug: 'gpt-5', status: 'deploying' }]
      }
    })

    expect(token.model).toContain('"model": "<model name>"')
  })

  test('uses the chat completions shape for a model the catalogue does not know', () => {
    const { token } = build({ catalogue: {} })

    expect(token.model).toContain('/openai/v1/chat/completions')
  })
})

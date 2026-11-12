import {
  applicationBody,
  confirmSchema,
  environmentsSchema,
  hostSchema,
  nameSchema,
  principalIdSchema,
  refusalText,
  serviceSchema
} from '#/server/routes/environments/federation-answers.js'

const PRINCIPAL_ID = '11111111-1111-4111-8111-111111111111'

function messageOf(schema, payload) {
  const { error } = schema.validate(payload)

  return error?.details[0].message
}

describe('federation answers', () => {
  describe('where it runs', () => {
    test.each(['cdp', 'azure'])('accepts %s', (host) => {
      expect(hostSchema.validate({ host }).error).toBeUndefined()
    })

    test('asks for an answer when there is none, and refuses any other', () => {
      expect(messageOf(hostSchema, {})).toBe(
        'Select where your application runs'
      )
      expect(messageOf(hostSchema, { host: 'aws' })).toBe(
        'Select where your application runs'
      )
    })
  })

  describe('the CDP service name', () => {
    test.each(['flood-api', 'a', 'a1-b2', 'x'.repeat(32)])(
      'accepts %s',
      (service) => {
        expect(serviceSchema.validate({ service }).error).toBeUndefined()
      }
    )

    test('trims what was typed', () => {
      expect(serviceSchema.validate({ service: ' flood-api ' }).value).toEqual({
        service: 'flood-api'
      })
    })

    test('asks for a name when there is none', () => {
      expect(messageOf(serviceSchema, { service: '' })).toBe(
        'Enter your CDP service name'
      )
      expect(messageOf(serviceSchema, {})).toBe('Enter your CDP service name')
    })

    test.each([
      'Flood-API',
      'flood_api',
      '-flood',
      'flood-',
      'flood--api',
      'flood api'
    ])('refuses %s as a name CDP would not accept', (service) => {
      expect(messageOf(serviceSchema, { service })).toBe(
        'The CDP service name must use only lower-case letters, numbers and single hyphens'
      )
    })

    test('refuses one longer than 32 characters', () => {
      expect(messageOf(serviceSchema, { service: 'x'.repeat(33) })).toBe(
        'The CDP service name must be 32 characters or fewer'
      )
    })
  })

  describe('the Azure principal ID', () => {
    test('accepts a GUID', () => {
      expect(
        principalIdSchema.validate({ principalId: PRINCIPAL_ID }).error
      ).toBeUndefined()
    })

    test('asks for one when there is none, and refuses one that is not a GUID', () => {
      expect(messageOf(principalIdSchema, { principalId: '' })).toBe(
        'Enter the managed identity’s principal ID'
      )
      expect(messageOf(principalIdSchema, { principalId: 'not-a-guid' })).toBe(
        'The principal ID must be a GUID, like 00000000-0000-0000-0000-000000000000'
      )
    })
  })

  describe('the Azure application name', () => {
    test.each(['flood-reports', 'a', 'mock-checks-failed'])(
      'accepts %s',
      (name) => {
        expect(nameSchema.validate({ name }).error).toBeUndefined()
      }
    )

    test('asks for a name when there is none', () => {
      expect(messageOf(nameSchema, { name: '' })).toBe(
        'Enter a name for your application'
      )
    })

    test.each(['Flood', '-flood', 'flood_reports', 'x'.repeat(64)])(
      'refuses %s',
      (name) => {
        expect(messageOf(nameSchema, { name })).toBe(
          'The name must use only lower-case letters, numbers and hyphens, start with a letter or number, and be 63 characters or fewer'
        )
      }
    )
  })

  describe('the environments', () => {
    test('accepts one or several, a single one posted as text', () => {
      expect(
        environmentsSchema.validate({ environments: 'infradev' }).value
      ).toEqual({ environments: ['infradev'] })
      expect(
        environmentsSchema.validate({ environments: ['infradev', 'qa'] }).value
      ).toEqual({ environments: ['infradev', 'qa'] })
    })

    test('asks for at least one', () => {
      expect(messageOf(environmentsSchema, {})).toBe(
        'Select at least one environment'
      )
      expect(messageOf(environmentsSchema, { environments: [] })).toBe(
        'Select at least one environment'
      )
    })

    test('refuses the same environment twice and names that are not codes', () => {
      expect(
        messageOf(environmentsSchema, { environments: ['qa', 'qa'] })
      ).toBe('Select each environment only once')
      expect(messageOf(environmentsSchema, { environments: ['Q A'] })).toBe(
        'Select environments from the list'
      )
    })
  })

  describe('the confirmation', () => {
    test('takes the key of the answers shown, which may be empty', () => {
      expect(confirmSchema.validate({}).value).toEqual({ key: '' })
      expect(confirmSchema.validate({ key: 'k' }).value).toEqual({ key: 'k' })
    })
  })

  describe('#applicationBody', () => {
    test('is a CDP service with only its name and the environments', () => {
      expect(
        applicationBody(
          { host: 'cdp', service: 'flood-api', principalId: 'x', name: 'y' },
          ['infradev', 'qa']
        )
      ).toEqual({
        host: 'cdp',
        service: 'flood-api',
        environments: ['infradev', 'qa']
      })
    })

    test('is an Azure application with its principal ID and name', () => {
      expect(
        applicationBody(
          { host: 'azure', principalId: PRINCIPAL_ID, name: 'flood-reports' },
          ['infradev']
        )
      ).toEqual({
        host: 'azure',
        principalId: PRINCIPAL_ID,
        name: 'flood-reports',
        environments: ['infradev']
      })
    })
  })

  describe('#refusalText', () => {
    const context = { name: 'flood-api', environmentName: 'Infradev' }

    test.each([
      [
        'federation-exists',
        'Infradev: your team already federates flood-api there'
      ],
      [
        'federation-trusted-elsewhere',
        'Infradev: another team already uses flood-api there'
      ],
      ['federation-limit-reached', 'Infradev already holds 20 applications'],
      [
        'environment-not-set-up',
        'Infradev is not set up yet. Deploy a model there first'
      ],
      ['environment-not-available', 'Infradev is not available yet']
    ])('says what %s means for an environment', (code, expected) => {
      expect(refusalText(code, context)).toBe(expected)
    })

    test('says a code it does not know plainly, naming the environment', () => {
      expect(refusalText('something-new', context)).toBe(
        'Infradev: flood-api cannot be federated there'
      )
    })
  })
})

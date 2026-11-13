import {
  deploymentsUrl,
  FORM_ANCHOR,
  readDeploymentsQuery
} from './deployments-query.js'

describe('#readDeploymentsQuery', () => {
  test('reads nothing as no filters and asks for what the backend defaults', () => {
    expect(readDeploymentsQuery({})).toEqual({
      filters: {
        environment: '',
        search: '',
        model: '',
        status: '',
        credential: ''
      },
      apiQuery: '',
      errors: null
    })
  })

  test('sends only what was given, trimmed, in a fixed order', () => {
    const { filters, apiQuery, errors } = readDeploymentsQuery({
      page: '2',
      credential: 'disabled',
      status: 'needs-attention',
      model: 'gpt-4o',
      search: '  flood ',
      environment: 'infradev'
    })

    expect(errors).toBeNull()
    expect(filters.search).toBe('flood')
    expect(apiQuery).toBe(
      'environment=infradev&search=flood&model=gpt-4o&status=needs-attention&credential=disabled&page=2'
    )
  })

  test('treats a value given twice, or not as text, as not given', () => {
    const { filters, apiQuery } = readDeploymentsQuery({
      search: ['a', 'b'],
      status: { x: 1 }
    })

    expect(filters.search).toBe('')
    expect(filters.status).toBe('')
    expect(apiQuery).toBe('')
  })

  test.each([
    ['one character', 'a'],
    ['101 characters', 'a'.repeat(101)]
  ])(
    'says search must be 2 to 100 characters for %s, on the search field',
    (_name, search) => {
      const { errors, apiQuery } = readDeploymentsQuery({ search })

      expect(apiQuery).toBeNull()
      expect(errors.errorSummary).toEqual([
        { text: 'Search must be 2 to 100 characters', href: '#search' }
      ])
      expect(errors.fieldErrors.search.text).toBe(
        'Search must be 2 to 100 characters'
      )
    }
  )

  test.each([
    ['status', 'broken', 'Choose a status from the list'],
    ['credential', 'broken', 'Choose a credential from the list']
  ])('says a %s that is not on the list', (field, value, text) => {
    const { errors } = readDeploymentsQuery({ [field]: value })

    expect(errors.errorSummary).toEqual([{ text, href: `#${field}` }])
    expect(errors.fieldErrors[field].text).toBe(text)
  })

  test('says an environment or model that cannot be one, with a link that goes somewhere on the page', () => {
    const { errors } = readDeploymentsQuery({
      environment: 'Not An Environment!',
      model: 'x'.repeat(101)
    })

    expect(errors.errorSummary).toEqual([
      { text: 'Choose a model from the list', href: '#model' },
      {
        text: 'Choose an environment from the tabs',
        href: FORM_ANCHOR
      }
    ])
    expect(errors.fieldErrors.model.text).toBe('Choose a model from the list')
    expect(errors.fieldErrors.environment).toBeUndefined()
  })

  test.each([['0'], ['-1'], ['1.5'], ['abc']])(
    'says page %s is not a whole number of 1 or more, linking to the search field',
    (page) => {
      const { errors } = readDeploymentsQuery({ page })

      expect(errors.errorSummary).toEqual([
        {
          text: 'The page number must be a whole number, 1 or more. Filter again to start from the first page',
          href: '#search'
        }
      ])
      expect(errors.fieldErrors).toEqual({})
    }
  )

  test('lists every error found, each on its own field', () => {
    const { errors } = readDeploymentsQuery({ search: 'a', status: 'x' })

    expect(errors.errorSummary.map(({ href }) => href)).toEqual([
      '#search',
      '#status'
    ])
  })
})

describe('#deploymentsUrl', () => {
  const filters = {
    environment: 'infradev',
    search: 'flood',
    model: '',
    status: 'ready',
    credential: ''
  }

  test('keeps the environment and the filters in the address, and a page after the first', () => {
    expect(deploymentsUrl(filters)).toBe(
      '/admin/deployments?environment=infradev&search=flood&status=ready'
    )
    expect(deploymentsUrl(filters, 3)).toBe(
      '/admin/deployments?environment=infradev&search=flood&status=ready&page=3'
    )
  })

  test('is the bare address with nothing to keep', () => {
    expect(deploymentsUrl({})).toBe('/admin/deployments')
  })

  test('escapes what it keeps', () => {
    expect(deploymentsUrl({ search: 'a&b c' })).toBe(
      '/admin/deployments?search=a%26b+c'
    )
  })
})

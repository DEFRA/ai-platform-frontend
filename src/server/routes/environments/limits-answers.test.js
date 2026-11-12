import { parseLimits } from './limits-answers.js'

const bounds = {
  tokensPerMinute: { min: 1, max: 5000 },
  requestsPerMinute: { min: 1, max: 300 }
}

function parse(tokensPerMinute, requestsPerMinute, limitBounds = bounds) {
  return parseLimits({ tokensPerMinute, requestsPerMinute }, limitBounds)
}

describe('#parseLimits', () => {
  test.each([
    ['2000', '120', 2000, 120],
    ['2,000', '1,20', 2000, 120],
    ['  2000  ', ' 120 ', 2000, 120],
    ['5000', '300', 5000, 300],
    ['1', '1', 1, 1],
    ['0002000', '120', 2000, 120]
  ])(
    'takes %j and %j as %i and %i, within the bounds and with their edges',
    (tokens, requests, expectedTokens, expectedRequests) => {
      expect(parse(tokens, requests)).toEqual({
        limits: {
          tokensPerMinute: expectedTokens,
          requestsPerMinute: expectedRequests
        }
      })
    }
  )

  test.each([undefined, '', '   '])('asks for a value that is %j', (blank) => {
    const { problems } = parse(blank, blank)

    expect(problems.errorSummary).toEqual([
      { text: 'Enter the tokens a minute', href: '#tokensPerMinute' },
      { text: 'Enter the requests a minute', href: '#requestsPerMinute' }
    ])
    expect(problems.fieldErrors).toEqual({
      tokensPerMinute: { text: 'Enter the tokens a minute' },
      requestsPerMinute: { text: 'Enter the requests a minute' }
    })
  })

  test.each(['12.5', 'abc', '-5', '1e3', '2 000x', '١٢٣', '+5'])(
    'refuses %j as not a whole number',
    (value) => {
      const { problems } = parse(value, '60')

      expect(problems.errorSummary).toEqual([
        {
          text: 'Tokens a minute must be a whole number, such as 2000',
          href: '#tokensPerMinute'
        }
      ])
    }
  )

  test.each(['0', '5001', '99999999999999999999999'])(
    'states the bounds for tokens a minute of %j',
    (value) => {
      const { problems } = parse(value, '60')

      expect(problems.fieldErrors.tokensPerMinute.text).toBe(
        'Tokens a minute must be between 1 and 5,000'
      )
    }
  )

  test('states the bounds for requests a minute, formatted', () => {
    const { problems } = parse('1000', '301', {
      ...bounds,
      requestsPerMinute: { min: 1, max: 12000 }
    })

    expect(problems).toBeUndefined()

    expect(
      parse('1000', '12001', {
        ...bounds,
        requestsPerMinute: { min: 1, max: 12000 }
      }).problems.fieldErrors.requestsPerMinute.text
    ).toBe('Requests a minute must be between 1 and 12,000')
  })

  test('reports each field’s own problem together', () => {
    const { problems } = parse('abc', '301')

    expect(problems.errorSummary.map(({ href }) => href)).toEqual([
      '#tokensPerMinute',
      '#requestsPerMinute'
    ])
  })

  test('keeps what was typed so the form can show it again', () => {
    const { problems } = parse('12.5', '')

    expect(problems.values).toEqual({
      tokensPerMinute: '12.5',
      requestsPerMinute: ''
    })
  })

  test('checks only the shape when there are no bounds to check against', () => {
    expect(parse('99999', '99999', null)).toEqual({
      limits: { tokensPerMinute: 99999, requestsPerMinute: 99999 }
    })
  })
})

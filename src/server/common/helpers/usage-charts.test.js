import { donut, niceMax, stackedBars } from './usage-charts.js'

const format = (value) => String(value)

describe('#niceMax', () => {
  test.each([
    [0, 1],
    [-5, 1],
    [0.7, 1],
    [1.2, 2],
    [23, 25],
    [260, 500],
    [4200, 5000],
    [9, 10]
  ])('rounds %d up to %d', (value, expected) => {
    expect(niceMax(value)).toBe(expected)
  })
})

describe('#stackedBars', () => {
  const categories = [
    { label: 'Jun', parts: [{ series: 0, value: 10 }] },
    {
      label: 'Nov',
      parts: [
        { series: 0, value: 20 },
        { series: 1, value: 5 }
      ],
      forecast: 8
    }
  ]

  test('draws a rect for each part and a pale cap for a forecast', () => {
    const svg = stackedBars({ label: 'Cost', categories, format })

    expect(svg.match(/<rect /g)).toHaveLength(4)
    expect(svg).toContain('class="app-chart__forecast"')
    expect(svg).toContain('class="app-chart__s0"')
    expect(svg).toContain('class="app-chart__s1"')
  })

  test('says where the same figures are, for a screen reader', () => {
    const svg = stackedBars({ label: 'Cost each month', categories, format })

    expect(svg).toContain('role="img"')
    expect(svg).toContain(
      'aria-label="Cost each month. The same figures are in the table below."'
    )
  })

  test('draws a marker line with its label when it is given one', () => {
    const svg = stackedBars({
      label: 'Cost',
      categories,
      format,
      marker: { value: 30, label: 'Budget £30' }
    })

    expect(svg).toContain('app-chart__marker')
    expect(svg).toContain('Budget £30')
  })

  test('escapes every label so a name cannot add markup', () => {
    const svg = stackedBars({
      label: 'x"><script>',
      categories: [{ label: '<b>', parts: [{ series: 0, value: 1 }] }],
      format
    })

    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('<b>')
    expect(svg).toContain('&lt;b&gt;')
  })

  test('draws nothing for a part of zero, and no NaN for an empty chart', () => {
    const empty = stackedBars({
      label: 'Empty',
      categories: [{ label: 'a', parts: [{ series: 0, value: 0 }] }],
      format
    })
    const none = stackedBars({ label: 'None', categories: [], format })

    expect(empty).not.toContain('<rect')
    expect(empty).not.toContain('NaN')
    expect(none).not.toContain('NaN')
  })

  test('labels a long axis every few bars, so the labels do not collide', () => {
    const days = Array.from({ length: 30 }, (_, index) => ({
      label: String(index + 1),
      parts: [{ series: 0, value: index }]
    }))
    const svg = stackedBars({ label: 'Days', categories: days, format })

    expect(svg.match(/app-chart__label/g).length).toBeLessThan(30)
  })

  test('uses no inline style, which the content security policy refuses', () => {
    expect(stackedBars({ label: 'x', categories, format })).not.toContain(
      'style='
    )
  })
})

describe('#donut', () => {
  test('splits a ring into one arc for each part that has a value', () => {
    const svg = donut({
      label: 'Share',
      parts: [
        { series: 0, value: 3 },
        { series: 1, value: 1 },
        { series: 2, value: 0 }
      ],
      centre: '£250',
      caption: 'so far'
    })

    expect(svg.match(/stroke-dasharray/g)).toHaveLength(2)
    expect(svg).toContain('£250')
    expect(svg).toContain('so far')
    expect(svg).not.toContain('style=')
  })

  test('is only the track when there is nothing to share', () => {
    const svg = donut({
      label: 'Share',
      parts: [{ series: 0, value: 0 }],
      centre: '0'
    })

    expect(svg).not.toContain('stroke-dasharray')
    expect(svg).not.toContain('NaN')
  })
})

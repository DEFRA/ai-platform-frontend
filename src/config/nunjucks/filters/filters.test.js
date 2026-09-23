import { assign } from './filters.js'

describe('assign', () => {
  test('merges multiple sources and returns the mutated target object', () => {
    const target = { alpha: 'a' }
    const firstSource = { beta: 'b' }
    const secondSource = { alpha: 'updated', gamma: 'c' }

    const result = assign(target, firstSource, secondSource)

    expect(result).toBe(target)
    expect(result).toEqual({
      alpha: 'updated',
      beta: 'b',
      gamma: 'c'
    })
  })

  test('defines __proto__ as an own property without mutating the target prototype', () => {
    const target = {}
    const source = JSON.parse('{"__proto__":{"polluted":true}}')

    assign(target, source)

    expect(Object.getPrototypeOf(target)).toBe(Object.prototype)
    expect(Object.hasOwn(target, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(target, '__proto__').value).toEqual({
      polluted: true
    })
    expect(target.polluted).toBeUndefined()
  })
})

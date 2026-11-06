import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { packages } = JSON.parse(
  readFileSync(path.join(root, 'package-lock.json'), 'utf8')
)

// joi 18.0.0 to 18.3.0 has a high advisory (prototype replacement through
// `__proto__` error codes). @defra/hapi-auth-oidc 0.6.0 pins joi 18.2.9, so
// package.json overrides the copy it loads until a release that depends on
// 18.3.1 or later has been out for the 7 days the package-age rule needs.
function atLeast(version, minimum) {
  const have = version.split('.').map(Number)
  const need = minimum.split('.').map(Number)
  const index = have.findIndex((part, position) => part !== need[position])

  return index === -1 || have[index] > need[index]
}

describe('#dependencies', () => {
  test('the joi that @defra/hapi-auth-oidc loads is outside the advisory range (18.3.1 or later)', () => {
    const own = packages['node_modules/@defra/hapi-auth-oidc/node_modules/joi']
    const shared = packages['node_modules/joi']

    expect(atLeast((own ?? shared).version, '18.3.1')).toBe(true)
  })
})

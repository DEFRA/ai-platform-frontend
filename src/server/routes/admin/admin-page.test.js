import { ApiError } from '#/server/common/helpers/api-client.js'
import { adminDeploymentUrl, adminTabs, isCallFailure } from './admin-page.js'

describe('#isCallFailure', () => {
  test.each([
    [500, true],
    [502, true],
    [409, true],
    [400, false],
    [403, false],
    [404, false]
  ])(
    'says an ApiError with status %i is a failure to repeat: %s',
    (statusCode, expected) => {
      expect(isCallFailure(new ApiError({ statusCode, code: 'x' }))).toBe(
        expected
      )
    }
  )

  test('says an error that is not the backend’s is not', () => {
    expect(isCallFailure(new Error('boom'))).toBe(false)
  })
})

describe('#adminTabs', () => {
  test('Should list Teams, Deployments and Audit log, in that order', () => {
    expect(adminTabs('teams')).toEqual([
      { text: 'Teams', href: '/admin/teams', current: true },
      { text: 'Deployments', href: '/admin/deployments', current: false },
      { text: 'Audit log', href: '/admin/audit', current: false }
    ])
  })

  test('Should mark Audit log as the current one on its own page', () => {
    expect(adminTabs('audit').map(({ current }) => current)).toEqual([
      false,
      false,
      true
    ])
  })

  test('Should mark Deployments as the current one on its pages', () => {
    expect(adminTabs('deployments').map(({ current }) => current)).toEqual([
      false,
      true,
      false
    ])
  })
})

describe('#adminDeploymentUrl', () => {
  test('Should name the team and the environment, each escaped', () => {
    expect(adminDeploymentUrl('team-1', 'infradev')).toBe(
      '/admin/deployments/team-1/infradev'
    )
    expect(adminDeploymentUrl('team 1/x', 'a b')).toBe(
      '/admin/deployments/team%201%2Fx/a%20b'
    )
  })
})

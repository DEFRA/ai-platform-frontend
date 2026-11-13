import { adminDeploymentUrl, adminTabs } from './admin-page.js'

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

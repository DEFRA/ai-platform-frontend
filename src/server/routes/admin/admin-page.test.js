import { adminTabs } from './admin-page.js'

describe('#adminTabs', () => {
  test('Should list Teams and Audit log, in that order', () => {
    expect(adminTabs('teams')).toEqual([
      { text: 'Teams', href: '/admin/teams', current: true },
      { text: 'Audit log', href: '/admin/audit', current: false }
    ])
  })

  test('Should mark Audit log as the current one on its own page', () => {
    expect(adminTabs('audit').map(({ current }) => current)).toEqual([
      false,
      true
    ])
  })
})

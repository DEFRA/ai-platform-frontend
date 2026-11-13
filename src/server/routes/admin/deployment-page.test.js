import { deploymentBreadcrumbs, environmentList } from './deployment-page.js'

const deployment = {
  team: { id: 'team 1', name: 'Flood Risk Team' },
  environment: 'infradev'
}

describe('#deploymentBreadcrumbs', () => {
  test('goes down to the team, which is the page itself', () => {
    expect(deploymentBreadcrumbs(deployment)).toEqual([
      { text: 'Home', href: '/' },
      { text: 'Admin', href: '/admin/teams' },
      { text: 'Deployments', href: '/admin/deployments' },
      {
        text: 'Development',
        href: '/admin/deployments?environment=infradev'
      },
      { text: 'Flood Risk Team' }
    ])
  })

  test('links the team to its deployment and ends with the action page', () => {
    const crumbs = deploymentBreadcrumbs(deployment, 'Disable credentials')

    expect(crumbs.slice(-2)).toEqual([
      { text: 'Flood Risk Team', href: '/admin/deployments/team%201/infradev' },
      { text: 'Disable credentials' }
    ])
  })
})

describe('#environmentList', () => {
  test.each([
    [[], ''],
    [['infradev'], 'Development'],
    [['infradev', 'qa'], 'Development and Test'],
    [['infradev', 'qa', 'prod'], 'Development, Test and Production']
  ])('says %j as "%s"', (codes, text) => {
    expect(environmentList(codes)).toBe(text)
  })
})

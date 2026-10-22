import createFetchMock from 'vitest-fetch-mock'

import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from '#/server/common/helpers/api-client.js'
import {
  isForbidden,
  isNotFound,
  loadTeamForView,
  teamNotFoundView,
  teamTabs,
  teamUrl
} from './team-view.js'

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

const team = { _id: 'team-1', slug: 'flood-risk-team', name: 'Flood Risk Team' }

function requestFor(userId) {
  return {
    headers: {},
    yar: { get: () => ({ id: userId }) }
  }
}

describe('#teamUrl', () => {
  test('is the team’s slug, never its id', () => {
    expect(teamUrl(team)).toBe('/teams/flood-risk-team')
  })

  test('escapes a slug that is not safe in an address', () => {
    expect(teamUrl({ slug: 'a/b?c' })).toBe('/teams/a%2Fb%3Fc')
  })
})

describe('#teamTabs', () => {
  test.each(['models', 'members', 'details'])(
    'lists Models, Members and Details, with only %s current',
    (current) => {
      const tabs = teamTabs(team, current)

      expect(tabs.map(({ text }) => text)).toEqual([
        'Models',
        'Members',
        'Details'
      ])
      expect(tabs.map(({ href }) => href)).toEqual([
        '/teams/flood-risk-team',
        '/teams/flood-risk-team/members',
        '/teams/flood-risk-team/details'
      ])
      expect(tabs.filter((tab) => tab.current).map(({ text }) => text)).toEqual(
        [current[0].toUpperCase() + current.slice(1)]
      )
    }
  )
})

describe('#teamNotFoundView', () => {
  test('is a 404 that does not say whether the team exists', () => {
    const code = vi.fn()
    const h = { view: vi.fn(() => ({ code })) }

    teamNotFoundView(h)

    expect(h.view).toHaveBeenCalledWith(
      'error/index',
      expect.objectContaining({
        heading: 'Team not found',
        message: 'This team does not exist, or you are not a member.',
        actionHref: '/teams'
      })
    )
    expect(code).toHaveBeenCalledWith(statusCodes.notFound)
  })
})

describe('#isForbidden and #isNotFound', () => {
  test('read the status of an API error, and nothing else', () => {
    const forbidden = new ApiError({ statusCode: 403, code: 'admin-required' })
    const missing = new ApiError({ statusCode: 404, code: 'not-found' })

    expect(isForbidden(forbidden)).toBe(true)
    expect(isForbidden(missing)).toBe(false)
    expect(isNotFound(missing)).toBe(true)
    expect(isNotFound(forbidden)).toBe(false)
    expect(isNotFound(new Error('404'))).toBe(false)
  })
})

describe('#loadTeamForView', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  function respondWith(members, extra = {}) {
    fetchMock.mockResponseOnce(JSON.stringify({ team, members, ...extra }))
  }

  const admin = (overrides) => ({
    userId: 'user-1',
    role: 'admin',
    status: 'active',
    ...overrides
  })
  const colleague = (overrides) => ({
    userId: 'user-2',
    email: 'colleague@defra.gov.uk',
    role: 'user',
    status: 'active',
    ...overrides
  })

  test('reads the team by the slug it is given, as the person', async () => {
    respondWith([admin()])

    await loadTeamForView(requestFor('user-1'), 'flood-risk-team')

    const [url, init] = fetchMock.mock.calls.at(-1)

    expect(url).toContain('/v1/teams/flood-risk-team')
    expect(init.headers['x-user-id']).toBe('user-1')
  })

  test('keeps the environments the backend gives with their limits', async () => {
    const environments = [{ environment: 'infradev', limits: {} }]

    respondWith([admin()], { environments })

    const result = await loadTeamForView(
      requestFor('user-1'),
      'flood-risk-team'
    )

    expect(result.environments).toEqual(environments)
  })

  test('says an active admin is one, and a member or an invited admin is not', async () => {
    respondWith([admin()])
    expect((await loadTeamForView(requestFor('user-1'), 'x')).isAdmin).toBe(
      true
    )

    respondWith([admin({ role: 'user' })])
    expect((await loadTeamForView(requestFor('user-1'), 'x')).isAdmin).toBe(
      false
    )

    respondWith([admin({ status: 'invited' })])
    expect((await loadTeamForView(requestFor('user-1'), 'x')).isAdmin).toBe(
      false
    )

    respondWith([colleague()])
    expect((await loadTeamForView(requestFor('user-1'), 'x')).isAdmin).toBe(
      false
    )
  })

  test('leaves out removed members', async () => {
    respondWith([admin(), colleague({ status: 'removed' })])

    const { members } = await loadTeamForView(requestFor('user-1'), 'x')

    expect(members).toHaveLength(1)
  })

  test('masks colleagues’ addresses from a member, and shows their own', async () => {
    respondWith([
      admin({ userId: 'user-1', role: 'user', email: 'me@defra.gov.uk' }),
      colleague(),
      colleague({ userId: 'user-3', email: 'not-an-address' })
    ])

    const { members } = await loadTeamForView(requestFor('user-1'), 'x')

    expect(members.map(({ email }) => email)).toEqual([
      'me@defra.gov.uk',
      'c********@defra.gov.uk',
      'Hidden'
    ])
  })

  test('shows every address to an admin', async () => {
    respondWith([admin(), colleague()])

    const { members } = await loadTeamForView(requestFor('user-1'), 'x')

    expect(members[1].email).toBe('colleague@defra.gov.uk')
  })

  test('says which member is the person', async () => {
    respondWith([admin({ _id: 'm-1' }), colleague({ _id: 'm-2' })])

    const [self, other] = (await loadTeamForView(requestFor('user-1'), 'x'))
      .members

    expect(self.isYou).toBe(true)
    expect(other.isYou).toBe(false)
  })
})

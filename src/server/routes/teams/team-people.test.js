import createFetchMock from 'vitest-fetch-mock'

import { ApiError } from '#/server/common/helpers/api-client.js'
import {
  addTeamMember,
  personProblem,
  searchTeamPeople
} from './team-people.js'

const fetchMock = createFetchMock(vi)
fetchMock.enableMocks()

// The signed-in person's tokens are in the session; the access token is not
// near its end, so no refresh is made.
const request = {
  headers: {},
  yar: {
    get: (key) =>
      key === 'tokens'
        ? {
            accessToken: 'session-access-token',
            refreshToken: 'session-refresh-token',
            expiresAt: Date.now() + 60 * 60 * 1000
          }
        : { id: 'user-1' }
  }
}
const OID = '0b8f6f4e-3c0f-4c46-9c58-2d3a8d2f1a11'
const KEY = '3f1c1c36-6a7e-4a52-8a53-1d2f5f0c9b11'

describe('#team people API', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('searchTeamPeople', () => {
    test('posts the search text to the team’s people search as the signed-in person and returns the items', async () => {
      const items = [
        { oid: OID, displayName: 'Priya Raman', email: 'priya@defra.gov.uk' }
      ]

      fetchMock.mockResponseOnce(JSON.stringify({ items }))

      const result = await searchTeamPeople(request, 'flood risk', 'priya')
      const [sent] = fetchMock.requests()

      expect(result).toEqual(items)
      expect(sent.method).toBe('POST')
      expect(sent.url).toContain('/v1/teams/flood%20risk/people/search')
      expect(sent.headers.get('authorization')).toBe(
        'Bearer session-access-token'
      )
      expect(sent.headers.has('x-user-id')).toBe(false)
      expect(await sent.json()).toEqual({ search: 'priya' })
    })

    test('lets a backend refusal through as the ApiError', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ code: 'admin-required', message: 'No' }),
        { status: 403 }
      )

      await expect(
        searchTeamPeople(request, 'flood-risk-team', 'priya')
      ).rejects.toMatchObject({ statusCode: 403, code: 'admin-required' })
    })
  })

  describe('addTeamMember', () => {
    test('posts the person’s oid and role with the idempotency key and returns the member', async () => {
      const member = { _id: 'member-4', displayName: 'Priya Raman' }

      fetchMock.mockResponseOnce(JSON.stringify({ member }), { status: 201 })

      const result = await addTeamMember(
        request,
        'flood-risk-team',
        { oid: OID, role: 'admin' },
        KEY
      )
      const [sent] = fetchMock.requests()

      expect(result).toEqual(member)
      expect(sent.method).toBe('POST')
      expect(sent.url).toContain('/v1/teams/flood-risk-team/members')
      expect(sent.headers.get('authorization')).toBe(
        'Bearer session-access-token'
      )
      expect(sent.headers.has('x-user-id')).toBe(false)
      expect(sent.headers.get('idempotency-key')).toBe(KEY)
      expect(await sent.json()).toEqual({ oid: OID, role: 'admin' })
    })
  })

  describe('personProblem', () => {
    test.each([
      ['member-exists', 409, 'This person is already a member of this team'],
      [
        'person-not-eligible',
        422,
        'This person cannot be added to a team. Search again and choose someone else'
      ],
      [
        'directory-unavailable',
        503,
        'We could not reach the directory. Try again in a few minutes'
      ],
      [
        'idempotency-key-reused',
        409,
        'We could not add this person. Check the person and role, then select Add again'
      ]
    ])('maps %s to its status and message', (code, statusCode, text) => {
      expect(personProblem(new ApiError({ statusCode, code }))).toEqual({
        statusCode,
        text
      })
    })

    test('has nothing to say about any other error, or anything that is not an ApiError', () => {
      expect(
        personProblem(new ApiError({ statusCode: 500, code: 'internal' }))
      ).toBeUndefined()
      expect(personProblem(new Error('member-exists'))).toBeUndefined()
    })
  })
})

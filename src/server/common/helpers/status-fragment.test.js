import { statusFragmentUrl, wantsStatusFragment } from './status-fragment.js'

describe('status-fragment', () => {
  describe('wantsStatusFragment', () => {
    test('is true only for ?fragment=status', () => {
      expect(wantsStatusFragment({ query: { fragment: 'status' } })).toBe(true)
    })

    test.each([undefined, '', 'Status', 'other', ['status', 'status']])(
      'is false for fragment %j',
      (fragment) => {
        expect(wantsStatusFragment({ query: { fragment } })).toBe(false)
      }
    )

    test('is false with no query at all', () => {
      expect(wantsStatusFragment({ query: {} })).toBe(false)
    })
  })

  describe('statusFragmentUrl', () => {
    test('is the page address with ?fragment=status', () => {
      expect(statusFragmentUrl('/teams/flood-risk-team')).toBe(
        '/teams/flood-risk-team?fragment=status'
      )
    })
  })
})

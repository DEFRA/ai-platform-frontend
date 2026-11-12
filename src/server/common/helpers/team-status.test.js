import { teamStatusTag } from './team-status.js'

describe('#teamStatusTag', () => {
  test.each([
    ['active', 'Active', 'govuk-tag--green'],
    ['disabled', 'Disabled', 'govuk-tag--grey'],
    ['pending-removal', 'Pending removal', 'govuk-tag--orange'],
    ['removed', 'Removed', 'govuk-tag--red']
  ])('Should show %s as %s', (status, text, classes) => {
    expect(teamStatusTag(status)).toEqual({ text, classes })
  })

  test('Should read a team with no status as active', () => {
    expect(teamStatusTag(undefined)).toEqual({
      text: 'Active',
      classes: 'govuk-tag--green'
    })
  })

  test('Should show a status it does not know as it is, in grey', () => {
    expect(teamStatusTag('archived')).toEqual({
      text: 'archived',
      classes: 'govuk-tag--grey'
    })
  })
})

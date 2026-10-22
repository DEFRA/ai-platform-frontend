import { renderComponent } from '#/test-helpers/component-helpers.js'

describe('Heading Component', () => {
  let $heading

  describe('With caption above', () => {
    beforeEach(() => {
      $heading = renderComponent('heading', {
        text: 'GPT-4o',
        caption: 'OpenAI',
        captionAbove: true
      })
    })

    test('Should put the caption before the heading', () => {
      const $caption = $heading('[data-testid="app-heading-caption"]')

      expect($caption.text().trim()).toBe('OpenAI')
      expect($caption.hasClass('govuk-caption-xl')).toBe(true)
      expect(
        $caption.nextAll('[data-testid="app-heading-title"]')
      ).toHaveLength(1)
    })

    test('Should render the caption once', () => {
      expect($heading('[data-testid="app-heading-caption"]')).toHaveLength(1)
    })
  })

  describe('With caption', () => {
    beforeEach(() => {
      $heading = renderComponent('heading', {
        text: 'Services',
        caption: 'A page showing available services'
      })
    })

    test('Should render app heading component', () => {
      expect($heading('[data-testid="app-heading"]')).toHaveLength(1)
    })

    test('Should contain expected heading', () => {
      expect($heading('[data-testid="app-heading-title"]').text().trim()).toBe(
        'Services'
      )
    })

    test('Should have expected heading caption', () => {
      expect(
        $heading('[data-testid="app-heading-caption"]').text().trim()
      ).toBe('A page showing available services')
    })
  })
})

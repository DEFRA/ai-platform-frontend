import { renderComponent } from '#/test-helpers/component-helpers.js'

const activeCredential = {
  _id: 'cred-1',
  status: 'active',
  renewalsRemaining: 3
}

const revokedCredential = {
  _id: 'cred-2',
  status: 'revoked',
  renewalsRemaining: 0
}

describe('Credential actions component', () => {
  test('Should always render a View button', () => {
    const $actions = renderComponent('credential-actions', {
      credential: activeCredential,
      showRenewRevoke: false
    })
    const $view = $actions('[data-testid="credential-action-view"]')

    expect($view).toHaveLength(1)
    expect($view.attr('href')).toBe('/manage/credentials/cred-1')
    expect($view.hasClass('govuk-button')).toBe(true)
    expect($view.hasClass('app-button--view')).toBe(true)
  })

  test('Should not render Renew or Revoke when showRenewRevoke is false', () => {
    const $actions = renderComponent('credential-actions', {
      credential: activeCredential,
      showRenewRevoke: false
    })

    expect($actions('[data-testid="credential-action-renew"]')).toHaveLength(0)
    expect($actions('[data-testid="credential-action-revoke"]')).toHaveLength(0)
  })

  test('Should render Renew and Revoke buttons for an active credential when showRenewRevoke is true', () => {
    const $actions = renderComponent('credential-actions', {
      credential: activeCredential,
      showRenewRevoke: true,
      crumb: 'crumb-token'
    })
    const $renew = $actions('[data-testid="credential-action-renew"]')
    const $revoke = $actions('[data-testid="credential-action-revoke"]')

    expect($renew.hasClass('app-button--renew')).toBe(true)
    expect($actions('input[name="crumb"]').val()).toBe('crumb-token')
    expect($revoke.attr('href')).toBe('/manage/credentials/cred-1/revoke')
    expect($revoke.hasClass('app-button--revoke')).toBe(true)
  })

  test('Should not render Renew when there are no renewals remaining', () => {
    const $actions = renderComponent('credential-actions', {
      credential: { ...activeCredential, renewalsRemaining: 0 },
      showRenewRevoke: true
    })

    expect($actions('[data-testid="credential-action-renew"]')).toHaveLength(0)
  })

  test('Should not render Renew or Revoke for a revoked credential', () => {
    const $actions = renderComponent('credential-actions', {
      credential: revokedCredential,
      showRenewRevoke: true
    })

    expect($actions('[data-testid="credential-action-renew"]')).toHaveLength(0)
    expect($actions('[data-testid="credential-action-revoke"]')).toHaveLength(0)
  })

  test('Should render Rotate and Revoke buttons for an active credential when showRotateRevoke is true', () => {
    const $actions = renderComponent('credential-actions', {
      credential: { ...activeCredential, showRotateRevoke: true }
    })
    const $rotate = $actions('[data-testid="credential-action-rotate"]')
    const $revoke = $actions('[data-testid="credential-action-revoke"]')

    expect($rotate).toHaveLength(1)
    expect($rotate.attr('href')).toBe('/manage/credentials/cred-1/rotate')
    expect($rotate.hasClass('app-button--rotate')).toBe(true)
    expect($revoke.attr('href')).toBe('/manage/credentials/cred-1/revoke')
  })

  test('Should not render Rotate or Revoke when showRotateRevoke is false', () => {
    const $actions = renderComponent('credential-actions', {
      credential: { ...activeCredential, showRotateRevoke: false }
    })

    expect($actions('[data-testid="credential-action-rotate"]')).toHaveLength(0)
    expect($actions('[data-testid="credential-action-revoke"]')).toHaveLength(0)
  })

  test('Should not render Rotate or Revoke for a revoked credential even when showRotateRevoke is true', () => {
    const $actions = renderComponent('credential-actions', {
      credential: { ...revokedCredential, showRotateRevoke: true }
    })

    expect($actions('[data-testid="credential-action-rotate"]')).toHaveLength(0)
    expect($actions('[data-testid="credential-action-revoke"]')).toHaveLength(0)
  })
})

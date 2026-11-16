import { statusCodes } from '#/server/common/constants/status-codes.js'
import { ApiError } from './api-error.js'
import {
  isDeployLocked,
  isEnvironmentLocked,
  isTeamDisabledError,
  lockBanner,
  lockContext,
  lockedPage,
  teamDisabledBack,
  teamDisabledPage,
  teamLockOf,
  withDisabledEnvironment
} from './team-lock.js'

const BACK = { href: '/teams/flood', text: 'Back to the team' }

function fakeToolkit() {
  const calls = []
  const h = {
    view(template, context) {
      calls.push({ template, context })

      return {
        code(statusCode) {
          calls.at(-1).statusCode = statusCode

          return calls.at(-1)
        }
      }
    }
  }

  return { h, calls }
}

describe('#teamLockOf', () => {
  test('reads a team with no lock fields as nothing locked', () => {
    expect(teamLockOf({ status: 'active' })).toEqual({
      teamDisabled: false,
      disabledEnvironments: []
    })
    expect(teamLockOf(undefined)).toEqual({
      teamDisabled: false,
      disabledEnvironments: []
    })
  })

  test('reads a disabled team and its disabled environments', () => {
    expect(
      teamLockOf({ status: 'disabled', disabledEnvironments: ['infradev'] })
    ).toEqual({ teamDisabled: true, disabledEnvironments: ['infradev'] })
  })

  test('reads an active team with a disabled environment', () => {
    expect(
      teamLockOf({ status: 'active', disabledEnvironments: ['qa'] })
    ).toEqual({ teamDisabled: false, disabledEnvironments: ['qa'] })
  })

  test('ignores a list that is not a list', () => {
    expect(
      teamLockOf({ disabledEnvironments: 'qa' }).disabledEnvironments
    ).toEqual([])
  })
})

describe('#isEnvironmentLocked', () => {
  test('is true only for an environment in the list, whatever the team status', () => {
    const lock = teamLockOf({
      status: 'disabled',
      disabledEnvironments: ['infradev']
    })

    expect(isEnvironmentLocked(lock, 'infradev')).toBe(true)
    expect(isEnvironmentLocked(lock, 'qa')).toBe(false)
    expect(isEnvironmentLocked(teamLockOf({ status: 'disabled' }), 'qa')).toBe(
      false
    )
  })
})

describe('#withDisabledEnvironment', () => {
  test('adds an environment to the disabled ones once, leaving the rest alone', () => {
    const lock = teamLockOf({
      status: 'disabled',
      disabledEnvironments: ['qa']
    })

    expect(withDisabledEnvironment(lock, 'infradev')).toEqual({
      teamDisabled: true,
      disabledEnvironments: ['qa', 'infradev']
    })
    expect(withDisabledEnvironment(lock, 'qa').disabledEnvironments).toEqual([
      'qa'
    ])
    expect(lock.disabledEnvironments).toEqual(['qa'])
  })
})

describe('#isDeployLocked', () => {
  const disabledTeam = teamLockOf({ status: 'disabled' })
  const activeTeam = teamLockOf({ status: 'active' })

  test('is locked in an environment that is disabled', () => {
    expect(
      isDeployLocked(
        teamLockOf({ status: 'active', disabledEnvironments: ['infradev'] }),
        'infradev',
        { setUp: true }
      )
    ).toBe(true)
    expect(
      isDeployLocked(activeTeam, 'infradev', { setUp: true, disabled: true })
    ).toBe(true)
  })

  test('is locked for a disabled team where the environment is not set up, because that sets one up', () => {
    expect(isDeployLocked(disabledTeam, 'qa', { setUp: false })).toBe(true)
    expect(isDeployLocked(disabledTeam, 'qa', undefined)).toBe(true)
  })

  test('is open in an environment that is set up and not ticked, even for a disabled team', () => {
    expect(isDeployLocked(disabledTeam, 'infradev', { setUp: true })).toBe(
      false
    )
  })

  test('is open for an active team', () => {
    expect(isDeployLocked(activeTeam, 'qa', { setUp: false })).toBe(false)
  })
})

describe('#isTeamDisabledError', () => {
  test('is true only for the backend refusal with the team-disabled code', () => {
    expect(
      isTeamDisabledError(
        new ApiError({ statusCode: 409, code: 'team-disabled', message: 'x' })
      )
    ).toBe(true)
    expect(
      isTeamDisabledError(
        new ApiError({ statusCode: 409, code: 'other', message: 'x' })
      )
    ).toBe(false)
    expect(isTeamDisabledError(new Error('team-disabled'))).toBe(false)
  })
})

describe('#lockBanner', () => {
  test('says the team is disabled and that it can be viewed but not changed', () => {
    expect(lockBanner(teamLockOf({ status: 'disabled' }))).toEqual({
      heading: 'This team is disabled',
      message: 'You can view it but you cannot change it.'
    })
  })

  test('says the environment is disabled on its own page when the team is active', () => {
    const lock = teamLockOf({ status: 'active', disabledEnvironments: ['qa'] })

    expect(lockBanner(lock, 'qa')).toEqual({
      heading: 'This environment is disabled',
      message: 'You can view it but you cannot change it.'
    })
    expect(lockBanner(lock, 'infradev')).toBeNull()
    expect(lockBanner(lock)).toBeNull()
  })

  test('never says why or who', () => {
    const banner = lockBanner(teamLockOf({ status: 'disabled' }))

    expect(JSON.stringify(banner)).not.toMatch(/reason|admin|because/i)
  })
})

describe('#lockContext', () => {
  test('gives the banner and whether team-wide actions are greyed', () => {
    expect(lockContext(teamLockOf({ status: 'disabled' }))).toEqual({
      lockBanner: expect.objectContaining({ heading: 'This team is disabled' }),
      teamLocked: true
    })
    expect(lockContext(teamLockOf({ status: 'active' }))).toEqual({
      lockBanner: null,
      teamLocked: false
    })
  })
})

describe('#teamDisabledPage', () => {
  test('is a 409 page that says the team cannot be changed, with the way back', () => {
    const { h, calls } = fakeToolkit()

    teamDisabledPage(h, BACK)

    expect(calls[0]).toEqual({
      template: 'error/index',
      context: {
        pageTitle: 'You cannot change this team',
        heading: 'You cannot change this team',
        message: 'This team is disabled. You can view it but not change it.',
        actionHref: '/teams/flood',
        actionText: 'Back to the team'
      },
      statusCode: statusCodes.conflict
    })
  })

  test('says it of the environment when only the environment is locked', () => {
    const { h, calls } = fakeToolkit()

    teamDisabledPage(h, BACK, { environment: true })

    expect(calls[0].context.message).toBe(
      'This environment is disabled. You can view it but not change it.'
    )
  })
})

describe('#lockedPage', () => {
  const where = { back: BACK }

  test('is the team page for a team-wide action when the team is disabled', () => {
    const { h, calls } = fakeToolkit()

    expect(
      lockedPage(h, teamLockOf({ status: 'disabled' }), where)
    ).toBeTruthy()
    expect(calls[0].statusCode).toBe(statusCodes.conflict)
  })

  test('is nothing for a team-wide action when the team is active, even with a disabled environment', () => {
    const { h } = fakeToolkit()

    expect(
      lockedPage(
        h,
        teamLockOf({ status: 'active', disabledEnvironments: ['qa'] }),
        where
      )
    ).toBeNull()
  })

  test('is the page for an environment action in a disabled environment only', () => {
    const { h, calls } = fakeToolkit()
    const lock = teamLockOf({
      status: 'disabled',
      disabledEnvironments: ['infradev']
    })

    expect(lockedPage(h, lock, { environment: 'qa', back: BACK })).toBeNull()
    expect(
      lockedPage(h, lock, { environment: 'infradev', back: BACK })
    ).toBeTruthy()
    expect(calls[0].context.message).toContain('This team is disabled')
  })

  test('says "environment" when the team is active and only the environment is locked', () => {
    const { h, calls } = fakeToolkit()

    lockedPage(
      h,
      teamLockOf({ status: 'active', disabledEnvironments: ['qa'] }),
      { environment: 'qa', back: BACK }
    )

    expect(calls[0].context.message).toContain('This environment is disabled')
  })
})

describe('#teamDisabledBack', () => {
  test('goes to the team page for a team address', () => {
    expect(
      teamDisabledBack({
        path: '/teams/flood/members/add',
        params: { slug: 'flood' }
      })
    ).toEqual({ href: '/teams/flood', text: 'Back to the team' })
  })

  test('goes to the environments overview for an environments address', () => {
    expect(
      teamDisabledBack({
        path: '/environments/flood/infradev/limits',
        params: { slug: 'flood' }
      })
    ).toEqual({
      href: '/environments/flood',
      text: 'Back to all environments'
    })
  })

  test('goes to the list of teams when the address names none', () => {
    expect(
      teamDisabledBack({ path: '/connect/team/check', params: {} })
    ).toEqual({ href: '/teams', text: 'Go to your teams' })
  })
})

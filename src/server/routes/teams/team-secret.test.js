import { TEAM_SECRET_STATE, teamSecretFor } from './team-secret.js'

const scope = { teamId: 'team-1', environment: 'infradev' }

const credential = {
  _id: 'cred-1',
  tier: 'team',
  teamId: 'team-1',
  environment: 'infradev',
  status: 'active',
  createdAt: '2026-10-21T10:00:00.000Z'
}

const activation = {
  environment: 'infradev',
  activatedAt: '2026-10-21T10:30:00.000Z'
}

describe('#teamSecretFor', () => {
  test('is ready for the active client secret of the team in the environment', () => {
    expect(teamSecretFor([credential], [activation], scope)).toEqual({
      state: TEAM_SECRET_STATE.ready,
      credential
    })
  })

  test('ignores a person’s own key, another team’s secret and another environment’s', () => {
    const others = [
      { ...credential, _id: 'research', tier: 'research' },
      { ...credential, _id: 'other-team', teamId: 'team-2' },
      { ...credential, _id: 'other-environment', environment: 'qa' }
    ]

    expect(teamSecretFor(others, [activation], scope)).toEqual({
      state: TEAM_SECRET_STATE.none,
      credential: null
    })
  })

  test('is preparing while the secret is not in the vault yet', () => {
    const unwritten = { ...credential, vaultState: 'unwritten' }

    expect(teamSecretFor([unwritten], [activation], scope)).toEqual({
      state: TEAM_SECRET_STATE.preparing,
      credential: unwritten
    })
  })

  test('prefers the active one to a newer revoked one', () => {
    const revoked = {
      ...credential,
      _id: 'cred-2',
      status: 'revoked',
      createdAt: '2026-10-21T11:00:00.000Z',
      revokedAt: '2026-10-21T11:30:00.000Z'
    }

    expect(
      teamSecretFor([revoked, credential], [activation], scope).credential
    ).toBe(credential)
  })

  describe('when none is active', () => {
    const revoked = {
      ...credential,
      status: 'revoked',
      revokedAt: '2026-10-21T11:00:00.000Z'
    }

    test('is revoked when the latest was revoked after the newest activation', () => {
      expect(teamSecretFor([revoked], [activation], scope)).toEqual({
        state: TEAM_SECRET_STATE.revoked,
        credential: revoked
      })
    })

    test('is none when the revocation came before the newest activation: a fresh one is on its way', () => {
      const later = {
        environment: 'infradev',
        activatedAt: '2026-10-21T12:00:00.000Z'
      }

      expect(teamSecretFor([revoked], [activation, later], scope).state).toBe(
        TEAM_SECRET_STATE.none
      )
    })

    test.each(['pending', 'failed'])(
      'is none when the replacement for a revoked one is %s',
      (status) => {
        const replacement = {
          ...credential,
          _id: 'cred-2',
          status,
          createdAt: '2026-10-21T12:00:00.000Z'
        }

        expect(
          teamSecretFor([revoked, replacement], [activation], scope).state
        ).toBe(TEAM_SECRET_STATE.none)
      }
    )

    test('is none when nothing says when it was revoked, or when a model turned active', () => {
      expect(
        teamSecretFor(
          [{ ...revoked, revokedAt: undefined }],
          [activation],
          scope
        ).state
      ).toBe(TEAM_SECRET_STATE.none)
      expect(teamSecretFor([revoked], [], scope).state).toBe(
        TEAM_SECRET_STATE.none
      )
    })

    test('looks only at activations in the environment', () => {
      expect(
        teamSecretFor([revoked], [{ ...activation, environment: 'qa' }], scope)
          .state
      ).toBe(TEAM_SECRET_STATE.none)
    })
  })

  test('is none for a person with no credentials at all', () => {
    expect(teamSecretFor([], [], scope)).toEqual({
      state: TEAM_SECRET_STATE.none,
      credential: null
    })
  })
})

import {
  KIND,
  STEP,
  backUrl,
  isAnswered,
  stepAfter,
  stepBefore
} from '#/server/routes/environments/federation-journey.js'

const team = { slug: 'flood-risk-team' }
const cdp = { kind: KIND.add, host: 'cdp' }
const azure = { kind: KIND.add, host: 'azure' }
const changeCdp = { kind: KIND.change, host: 'cdp' }
const changeAzure = { kind: KIND.change, host: 'azure' }

describe('federation journey order', () => {
  describe('#stepAfter', () => {
    test('goes from where it runs to the CDP service, or to the Azure principal ID', () => {
      expect(stepAfter(cdp, STEP.where)).toBe(STEP.service)
      expect(stepAfter(azure, STEP.where)).toBe(STEP.principalId)
    })

    test('asks for an Azure application’s name after its principal ID', () => {
      expect(stepAfter(azure, STEP.principalId)).toBe(STEP.name)
    })

    test('asks which environments after the last question of an addition', () => {
      expect(stepAfter(cdp, STEP.service)).toBe(STEP.environments)
      expect(stepAfter(azure, STEP.name)).toBe(STEP.environments)
    })

    test('goes from the last question of a change straight to the check, which has no environments to ask', () => {
      expect(stepAfter(changeCdp, STEP.service)).toBe(STEP.check)
      expect(stepAfter(changeAzure, STEP.name)).toBe(STEP.check)
    })

    test('checks the answers after the environments', () => {
      expect(stepAfter(cdp, STEP.environments)).toBe(STEP.check)
    })
  })

  describe('#stepBefore', () => {
    test('has nothing before the first question', () => {
      expect(stepBefore(cdp, STEP.where)).toBeNull()
    })

    test('goes back from the CDP service or the principal ID to where it runs, for an addition only', () => {
      expect(stepBefore(cdp, STEP.service)).toBe(STEP.where)
      expect(stepBefore(azure, STEP.principalId)).toBe(STEP.where)
      expect(stepBefore(changeCdp, STEP.service)).toBeNull()
      expect(stepBefore(changeAzure, STEP.principalId)).toBeNull()
    })

    test('goes back from the name to the principal ID', () => {
      expect(stepBefore(azure, STEP.name)).toBe(STEP.principalId)
    })

    test('goes back from the environments to the last question', () => {
      expect(stepBefore(cdp, STEP.environments)).toBe(STEP.service)
      expect(stepBefore(azure, STEP.environments)).toBe(STEP.name)
    })

    test('goes back from the check to the environments, or past them when they were skipped, or for a change', () => {
      expect(stepBefore(cdp, STEP.check)).toBe(STEP.environments)
      expect(
        stepBefore({ ...cdp, environmentsSkipped: true }, STEP.check)
      ).toBe(STEP.service)
      expect(stepBefore(changeAzure, STEP.check)).toBe(STEP.name)
    })
  })

  describe('#backUrl', () => {
    test('is the step before, in the team’s journey', () => {
      expect(backUrl(team, cdp, STEP.service)).toBe(
        '/environments/flood-risk-team/federate'
      )
      expect(backUrl(team, azure, STEP.name)).toBe(
        '/environments/flood-risk-team/federate/principal-id'
      )
    })

    test('is the environment a journey started from, from its first page', () => {
      expect(backUrl(team, { ...cdp, start: 'infradev' }, STEP.where)).toBe(
        '/environments/flood-risk-team/infradev'
      )
    })

    test('is the overview when it started there', () => {
      expect(backUrl(team, cdp, STEP.where)).toBe(
        '/environments/flood-risk-team'
      )
    })

    test('is the environment of the application being changed', () => {
      expect(
        backUrl(
          team,
          { ...changeCdp, target: { environment: 'qa', federationId: 'a' } },
          STEP.service
        )
      ).toBe('/environments/flood-risk-team/qa')
    })
  })

  describe('#isAnswered', () => {
    test('needs a CDP service and the environments', () => {
      expect(isAnswered(undefined)).toBe(false)
      expect(isAnswered({ host: 'cdp', service: 'a' })).toBe(false)
      expect(isAnswered({ host: 'cdp', environments: ['qa'] })).toBe(false)
      expect(
        isAnswered({ host: 'cdp', service: 'a', environments: ['qa'] })
      ).toBe(true)
    })

    test('needs an Azure principal ID, a name and the environments', () => {
      expect(
        isAnswered({ host: 'azure', principalId: 'p', environments: ['qa'] })
      ).toBe(false)
      expect(
        isAnswered({
          host: 'azure',
          principalId: 'p',
          name: 'n',
          environments: ['qa']
        })
      ).toBe(true)
    })

    test('is not answered with no environments', () => {
      expect(isAnswered({ host: 'cdp', service: 'a', environments: [] })).toBe(
        false
      )
    })
  })
})

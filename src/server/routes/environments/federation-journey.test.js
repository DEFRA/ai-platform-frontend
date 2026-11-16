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
    test('asks which environments straight after where the application runs', () => {
      expect(stepAfter(cdp, STEP.where)).toBe(STEP.environments)
      expect(stepAfter(azure, STEP.where)).toBe(STEP.environments)
    })

    test('goes from the environments to the CDP service, or to the Azure principal ID', () => {
      expect(stepAfter(cdp, STEP.environments)).toBe(STEP.service)
      expect(stepAfter(azure, STEP.environments)).toBe(STEP.principalId)
    })

    test('goes from the environments straight to the check when every answer is already held', () => {
      expect(
        stepAfter(
          { ...cdp, service: 'a', environments: ['qa'] },
          STEP.environments
        )
      ).toBe(STEP.check)
    })

    test('asks for an Azure application’s name after its principal ID', () => {
      expect(stepAfter(azure, STEP.principalId)).toBe(STEP.name)
    })

    test('checks the answers after the last question, of an addition or a change', () => {
      expect(stepAfter(cdp, STEP.service)).toBe(STEP.check)
      expect(stepAfter(azure, STEP.name)).toBe(STEP.check)
      expect(stepAfter(changeCdp, STEP.service)).toBe(STEP.check)
      expect(stepAfter(changeAzure, STEP.name)).toBe(STEP.check)
    })
  })

  describe('#stepBefore', () => {
    test('has nothing before the first question', () => {
      expect(stepBefore(cdp, STEP.where)).toBeNull()
    })

    test('goes back from the environments to where it runs', () => {
      expect(stepBefore(cdp, STEP.environments)).toBe(STEP.where)
    })

    test('goes back from the CDP service or the principal ID to the environments, for an addition only', () => {
      expect(stepBefore(cdp, STEP.service)).toBe(STEP.environments)
      expect(stepBefore(azure, STEP.principalId)).toBe(STEP.environments)
      expect(stepBefore(changeCdp, STEP.service)).toBeNull()
      expect(stepBefore(changeAzure, STEP.principalId)).toBeNull()
    })

    test('goes back from the name to the principal ID', () => {
      expect(stepBefore(azure, STEP.name)).toBe(STEP.principalId)
    })

    test('goes back from the check to the last question', () => {
      expect(stepBefore(cdp, STEP.check)).toBe(STEP.service)
      expect(stepBefore(azure, STEP.check)).toBe(STEP.name)
      expect(stepBefore(changeAzure, STEP.check)).toBe(STEP.name)
    })
  })

  describe('#backUrl', () => {
    test('is the step before, in the team’s journey', () => {
      expect(backUrl(team, cdp, STEP.service)).toBe(
        '/environments/flood-risk-team/federate/environments'
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

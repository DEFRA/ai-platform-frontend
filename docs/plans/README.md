# Plans

Plans live in one of two folders. Move a plan to `implemented/` when every phase is built, and repoint its links.

## In progress

| Plan                                                                               | State (20 Oct 2026)                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [build-stories-delivery-plan.md](in-progress/build-stories-delivery-plan.md)       | Build stories in phases; Phases 3 (IaC) and 4 (team GitOps) merged and applied in Infradev; Phases 0, 1, 5 (limits), 6 and 7 not started, B18 waits for Entra consent                                                                                            |
| [iac-rollout-state.md](in-progress/iac-rollout-state.md)                           | IaC rollout and the portal-to-team-apply proof: what is done, gotchas, what is left                                                                                                                                                                              |
| [research-tier-integration-plan.md](in-progress/research-tier-integration-plan.md) | Real Azure behind the research tier; Phases 0 to 3 and 5 built, Phase 4 (ARM liveness reconcile) deferred by decision, Phase 6 (CDP deployment) done through the research tier plan                                                                              |
| [research-tier-infradev-plan.md](in-progress/research-tier-infradev-plan.md)       | Research tier IaC and the portal move off the hand-built resource group; R0 to R7 merged and applied (infra v0.9.1, research API live in Infradev, CDP dev configured); open: the dev proxy rule for GitHub artifacts and R8 (journey tests, built-state record) |

## Implemented

| Plan                                                                                                           | Built                                          |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [route0-welcome-plan.md](implemented/route0-welcome-plan.md)                                                   | 29 Sept 2026                                   |
| [route1-plan.md](implemented/route1-plan.md) (research tier)                                                   | 22 Sept 2026                                   |
| [route2-plan.md](implemented/route2-plan.md) (team tier, first person)                                         | 23 Sept 2026                                   |
| [route3-plan.md](implemented/route3-plan.md) (team tier, joining a team)                                       | 25 Sept 2026                                   |
| [centralised-gateway/centralised-gateway-plan.md](implemented/centralised-gateway/centralised-gateway-plan.md) | 9 Oct 2026 (rolled out to CDP dev 20 Oct 2026) |

The source UI flow is [../ui-flow-three-routes.md](../ui-flow-three-routes.md); what is built, feature by feature, is [../implemented-features.md](../implemented-features.md).

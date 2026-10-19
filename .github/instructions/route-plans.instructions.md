---
description: 'Use when building or modifying any part of the "three routes to a credential" journey — not just the route folders themselves, but the shared helpers, config, components, plugins and test-helpers a route implementation typically also touches. Points to the authoritative plan docs and cross-repo design context so new work builds on what is already decided/built rather than re-deriving it.'
applyTo: 'src/**, test-helpers/**, docs/plans/**, docs/ui-flow-three-routes.md'
---

# The "three routes to a credential" journey

This service's core journey (browse a model, request a credential, manage a team's access) is
specified end-to-end in committed plan docs — read the relevant one before adding or changing
anything the journey touches, rather than re-deriving the flow from scratch. That's rarely just
the route folder: past work under this journey has also touched `src/server/common/helpers/`
(session, require-sign-in), `src/server/common/components/` (new Nunjucks components),
`src/config/` (session TTL, nunjucks navigation context), `src/server/plugins/router.js`
(registering new route plugins) and `test-helpers/` (journey/session test setup) — check the
plan's own "Relevant files" and "Steps" sections for the exact list on a given route:

- [docs/plans/implemented/route0-welcome-plan.md](../../docs/plans/implemented/route0-welcome-plan.md) — home page (`/`). Implemented (29 Sept 2026).
- [docs/plans/implemented/route1-plan.md](../../docs/plans/implemented/route1-plan.md) — research tier shared model access (`/models`, `/connect/shared/*`, `/manage`). Implemented.
- [docs/plans/implemented/route2-plan.md](../../docs/plans/implemented/route2-plan.md) — team tier, first person in a team (`/teams`, `/connect/team/*`). Implemented.
- [docs/plans/implemented/route3-plan.md](../../docs/plans/implemented/route3-plan.md) — team tier, joining a team that has access (rotate/revoke role enforcement). Implemented.

Cross-cutting plans under `docs/plans/implemented/integration/`, `docs/plans/implemented/centralised-gateway/` and
`docs/plans/in-progress/` are not
journey routes, but change what a route's pages render and which errors they must handle. The
cross-repository IaC baseline plan lives in `ai-platform-discovery-docs`, beside the design pack it
implements:

- [docs/plans/implemented/integration/research-tier-integration-plan.md](../../docs/plans/implemented/integration/research-tier-integration-plan.md) — replaces Route 1's mocked credential issuer and seed catalogue with real Azure APIM and a GitHub-hosted catalogue, and adds an audited credential view/re-share page under `/manage`. Phase 0 (Azure setup), Phase 1 (backend-only: `CredentialIssuer` registry/Azure adapter), Phase 2 (backend-only: `CatalogueSource` sync, real catalogue content pushed and tagged `v0.1.0` in `ai-platform-infra`), Phase 3 (backend-only: Key Vault persistence, audited `POST /v1/credentials/{id}/reveal`) and Phase 5 (frontend: real gateway request shapes replacing the mock `endpoint` field, catalogue pages show ineligible/retired models instead of hiding them, `/manage/credentials/{id}/view` reveal journey) are all complete. Phase 4 and Phase 6 are **deferred, not removed** (user decision) — still valid future work, don't start them without being asked. Read before changing `/models`, `/connect/shared/*` or anything rendering a credential.
- [docs/plans/implemented/centralised-gateway/centralised-gateway-plan.md](../../docs/plans/implemented/centralised-gateway/centralised-gateway-plan.md) — adopts the 8 Oct 2026 design-pack direction that Azure APIM is the **only** gateway and credential adapter, and that Bedrock/direct vendor APIs are hosting platforms _behind_ it. Models stop declaring `cloud`/`adapter` and inherit a nested `hosting`/`gateway` from their provider offering; `adapter` is renamed `gateway` throughout, except in the backend's `src/adapters/` folder where it stays as the ports-and-adapters design-pattern term. Frontend impact is small: the model page caption and "Where it runs" row come from the model's `hosting` (a `direct` offering names its host and shows only the data zone). **Phases R-H complete (9 Oct 2026); Phase I (discovery-docs built-state reporting) waits for the backend and frontend releases.** Read before touching `/models` view-model code or anything that displays where a model runs.
- [ai-platform-discovery-docs/docs/iac-baseline-plan.md](../../../ai-platform-discovery-docs/docs/iac-baseline-plan.md) — the 12 Oct 2026 minimum IaC baseline for Phase 1 in SND1 (`infradev`): Terraform, reusable GitHub Actions workflows, team and pin JSON schemas, and the CDP-style write path where the Portal API dispatches a `submit` workflow with the whole team document instead of committing itself. Replaces the mock `TenantOrchestrator` behind Route 2's dedicated model request and adds `infradev` as a team environment. Build stories B15 and B16 carry it; B13, B14 and B17 to B19 carry the 12 Oct 2026 teams direction (design F: AI Platform teams separate from CDP teams, Admin and Member roles, several teams per person, service-code chargeback with no separate billing code). **Phase 1 is applied in Infradev (15 Oct 2026); see [docs/plans/in-progress/iac-rollout-state.md](../../docs/plans/in-progress/iac-rollout-state.md) for what is done and left.** Read before changing `/connect/team/*` provisioning status, team environments or anything that shows a team's gateway path.
- [docs/plans/in-progress/build-stories-delivery-plan.md](../../docs/plans/in-progress/build-stories-delivery-plan.md) — the phased delivery plan for build stories B01 to B19, written against `ai-platform-discovery-docs` PR #18 (13 Oct 2026). Phase 0 restructures `build-stories.md`; Phases 1 to 6 deliver the rest. Records which stories are Implemented, Partial or Proposal and, importantly, the places where built code contradicts the design and must be refactored rather than extended. **In progress (15 Oct 2026): Phase 3 (IaC baseline) is applied in Infradev; Phases 0, 1, 5, 6 and 7 are not started.** Read before starting any build story, to check whether the work is a refactor rather than a new feature.

Each plan's "STATUS" line at the top records whether it has been built. Cross-repo context:

- [docs/ui-flow-three-routes.md](../../docs/ui-flow-three-routes.md) — the source UI flow diagrams (route paths, API contract, known gaps), with the original images, captured in text since the originals aren't in any repo.
- [ai-platform-discovery-docs/src/content/design-orchestration.md](../../../ai-platform-discovery-docs/src/content/design-orchestration.md) — design C, the GitOps-vs-Direct-API split that shapes the team-tier (`/connect/team/*`) backend model.
- The matching backend work for each route lives in `ai-platform-backend-api` — see its [.github/instructions/route-plans.instructions.md](../../../ai-platform-backend-api/.github/instructions/route-plans.instructions.md).

## Keeping these plans current

The `docs/plans/**` files are the single source of truth for this journey — there is no separate
copy anywhere else (agent memory is session/workspace-local and must not hold a competing copy of
plan content). Plans live in [docs/plans/implemented/](../../docs/plans/implemented/) when every
phase is built, and in [docs/plans/in-progress/](../../docs/plans/in-progress/) while any phase
remains (see [docs/plans/README.md](../../docs/plans/README.md)); move a plan across, and
repoint its links, when its `STATUS` changes. When a design change lands:

1. Edit the affected `docs/plans/implemented/routeN-plan.md` directly — update its `STATUS`/decisions and add a
   dated note (`**UPDATED <date>** — ...` or `**REWORKED <date>** — ...`), matching the existing
   convention already used in these files, rather than rewriting history.
2. If the change affects the UI flow itself (new/renamed route, changed step order), update
   [docs/ui-flow-three-routes.md](../../docs/ui-flow-three-routes.md) too so the two stay consistent.
3. If the change originates from a design-pack update in `ai-platform-discovery-docs` (e.g. a new
   orchestration decision), re-check the cross-repo context links above still describe it correctly.

### Whenever you touch a plan, keep the folders and the README in sync

Do all of this in the same change, without being asked. A plan edit is not finished until the
layout agrees with it.

1. **Folder matches status.** A plan lives in `docs/plans/implemented/` only when every phase it
   plans to build is built (a phase that is deliberately deferred must say so at the top of the
   plan); otherwise it lives in `docs/plans/in-progress/`. When a `STATUS` changes, `git mv` the
   plan (and its folder, if it has one) across, and keep `in-progress/` flat: one file per plan.
2. **README matches the folders.** Update [docs/plans/README.md](../../docs/plans/README.md) in
   the same change: one row per plan, in the table for the folder it is in, with its current state
   or built date. Add a row for a new plan; remove the row when a plan is deleted.
3. **Links follow the move.** Repoint every inbound link and mention (other plans, both repos'
   `route-plans.instructions.md` and `implemented-features.instructions.md`,
   `docs/implemented-features.md`, `docs/ui-flow-three-routes.md`, READMEs, code comments), and
   fix the moved plan's own relative links. Search the workspace for the old path, then check that
   every relative link under `docs/` still resolves.
4. **Status lines agree.** The plan's `STATUS` line, its row in `docs/plans/README.md`, and
   `docs/implemented-features.md` (when something became built) must say the same thing; update
   the dated note at the bottom of the plan too.
5. **Format.** Run `npx prettier --write docs/plans` and confirm the files are not empty before
   finishing; stage a new plan file with `git add` so an editor cannot lose it.

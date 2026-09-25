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

- [docs/plans/route0-welcome-plan.md](../../docs/plans/route0-welcome-plan.md) — home page (`/`). Not yet implemented.
- [docs/plans/route1-plan.md](../../docs/plans/route1-plan.md) — research tier shared model access (`/models`, `/connect/shared/*`, `/manage`). Implemented.
- [docs/plans/route2-plan.md](../../docs/plans/route2-plan.md) — team tier, first person in a team (`/teams`, `/connect/team/*`). Implemented.
- [docs/plans/route3-plan.md](../../docs/plans/route3-plan.md) — team tier, joining a team that has access (rotate/revoke role enforcement). Implemented.

Each plan's "STATUS" line at the top records whether it has been built. Cross-repo context:

- [docs/ui-flow-three-routes.md](../../docs/ui-flow-three-routes.md) — the source UI flow diagrams (route paths, API contract, known gaps), with the original images, captured in text since the originals aren't in any repo.
- [ai-platform-discovery-docs/src/content/design-orchestration.md](../../../ai-platform-discovery-docs/src/content/design-orchestration.md) — design C, the GitOps-vs-Direct-API split that shapes the team-tier (`/connect/team/*`) backend model.
- The matching backend work for each route lives in `ai-platform-backend-api` — see its [.github/instructions/route-plans.instructions.md](../../../ai-platform-backend-api/.github/instructions/route-plans.instructions.md).

## Keeping these plans current

The `docs/plans/*.md` files are the single source of truth for this journey — there is no separate
copy anywhere else (agent memory is session/workspace-local and must not hold a competing copy of
plan content). When a design change lands:

1. Edit the affected `docs/plans/routeN-plan.md` directly — update its `STATUS`/decisions and add a
   dated note (`**UPDATED <date>** — ...` or `**REWORKED <date>** — ...`), matching the existing
   convention already used in these files, rather than rewriting history.
2. If the change affects the UI flow itself (new/renamed route, changed step order), update
   [docs/ui-flow-three-routes.md](../../docs/ui-flow-three-routes.md) too so the two stay consistent.
3. If the change originates from a design-pack update in `ai-platform-discovery-docs` (e.g. a new
   orchestration decision), re-check the cross-repo context links above still describe it correctly.

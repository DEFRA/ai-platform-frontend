---
description: 'Use when building or modifying any part of the "three routes to a credential" journey — not just the route folders themselves, but the shared helpers, config, components, plugins and test-helpers a route implementation typically also touches. Points to the authoritative plan docs and cross-repo design context so new work builds on what is already decided/built rather than re-deriving it.'
applyTo: 'src/**, test-helpers/**, docs/plans/**, docs/flat-design-updates/v3/build-plan.md'
---

# The "three routes to a credential" journey

This service's core journey (browse a model, request a credential, manage a team's access) is documented in two places
under [docs/plans/](../../docs/plans/README.md). Read the relevant file before adding or changing anything the journey
touches, rather than re-deriving the flow. That is rarely just the route folder: past work has also touched
`src/server/common/helpers/` (session, require-sign-in), `src/server/common/components/`, `src/config/` (session TTL,
navigation context), `src/server/plugins/router.js` and `test-helpers/`.

**Built** (one file per category, in [docs/plans/implemented/](../../docs/plans/implemented/)):

- [01-portal-journeys.md](../../docs/plans/implemented/01-portal-journeys.md): routes 0 to 3, sign-in, pages, flat design. Read before changing any page or `/manage`.
- [02-research-tier.md](../../docs/plans/implemented/02-research-tier.md): research keys, real Azure, Key Vault, environments. Read before changing `/models`, `/connect/shared/*` or anything rendering a credential.
- [03-team-tier.md](../../docs/plans/implemented/03-team-tier.md): teams, roles, dedicated models, GitOps progress and status labels. Read before changing `/connect/team/*` or team environments.
- [04-catalogue-and-gateway.md](../../docs/plans/implemented/04-catalogue-and-gateway.md): the catalogue and the hosting/gateway shape. Read before touching model view models or anything showing where a model runs.
- [05-platform-and-gitops-pipeline.md](../../docs/plans/implemented/05-platform-and-gitops-pipeline.md): the five repositories, Infradev, CDP dev and operating notes.
- [06-shared-services-and-security.md](../../docs/plans/implemented/06-shared-services-and-security.md): idempotency, audit, locks, backfills, security.

**Not built** (one file): [docs/plans/remaining.md](../../docs/plans/remaining.md). Read it before starting any build story, to
check whether the work is a refactor of something built rather than a new feature, and which items are blocked or deferred.

Cross-repo context:

- [docs/flat-design-updates/v3/build-plan.md](../../docs/flat-design-updates/v3/build-plan.md): the source UI flow (route paths, API contract, known gaps).
- [ai-platform-discovery-docs/docs/iac-baseline-plan.md](../../../ai-platform-discovery-docs/docs/iac-baseline-plan.md): the IaC baseline behind B15 and B16.
- [ai-platform-discovery-docs/src/content/design-orchestration.md](../../../ai-platform-discovery-docs/src/content/design-orchestration.md): design C, the GitOps-versus-direct-API split behind `/connect/team/*`.
- The matching backend work: [ai-platform-backend-api route-plans.instructions.md](../../../ai-platform-backend-api/.github/instructions/route-plans.instructions.md).

## Keeping these plans current

The `docs/plans/**` files are the single source of truth for this journey; there is no separate copy anywhere else (agent
memory must not hold a competing copy). When a design change or a feature lands:

1. Edit the matching `implemented/NN-*.md` file, or move the item out of `remaining.md` into it. Add a dated line; do not
   rewrite history (git keeps it).
2. If the UI flow itself changes (new or renamed route, changed step order), update
   [docs/flat-design-updates/v3/build-plan.md](../../docs/flat-design-updates/v3/build-plan.md) too.
3. If the change comes from a design-pack update in `ai-platform-discovery-docs`, re-check the cross-repo links above.

### Whenever you touch a plan, keep the folders and the README in sync

Do all of this in the same change, without being asked.

1. **Two places only.** Built work lives in `docs/plans/implemented/` (one numbered file per category); everything not built
   lives in the single file `docs/plans/remaining.md`. Do not add plan files anywhere else.
2. **Move, do not copy.** When something is built, remove its entry from `remaining.md` and put it in the matching
   `implemented/` file (add a new numbered file for a new category). A deliberately deferred item stays in `remaining.md`
   marked "deferred, not removed". A story-related item also keeps `remaining.md`'s "At a glance" table and discovery-docs
   `build-stories.md#status` in agreement (see the mirror bullet in
   [copilot-instructions.md](../copilot-instructions.md#how-copilot-should-respond)).
3. **README matches.** Update the tables in [docs/plans/README.md](../../docs/plans/README.md) and
   [docs/plans/implemented/implemented-features.md](../../docs/plans/implemented/implemented-features.md) in the same change.
4. **Links follow.** Repoint every inbound link (both repos' instructions, READMEs, code comments) and check every relative
   link under `docs/` still resolves.
5. **Format.** Run `npx prettier --write docs/plans docs/plans/implemented/implemented-features.md` and confirm the files are not empty before
   finishing; stage a new file with `git add` so an editor cannot lose it.

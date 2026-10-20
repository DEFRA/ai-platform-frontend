---
mode: agent
description: 'R6 - make team deployment verification finish, record why it failed, and list the real Azure resources on the progress page.'
---

You are implementing **Phase R6** of
`docs/plans/in-progress/research-tier-infradev-plan.md`. Read that phase in full first, then this.

**Do this one first.** It is the blocker for the whole team-tier demo: nothing reaches `active`
today, so no team credential can be issued and the page shows progress for ever.

## Repositories

`ai-platform-backend-api` (most of it) and `ai-platform-frontend` (the rendering).

## The defect, already diagnosed - do not re-derive it

In `src/adapters/github/github-tenant-orchestrator.js`, `verifyDeployed` calls the verifier and
destructures only `{ verified }`, **discarding the `reason`**. When verification does not pass it
returns `{ status: 'deployed' }` - the status the entry already holds - so `persistStatus` in
`src/services/team-deployment-gitops.js` sees no change, writes nothing and audits nothing. The
next poll repeats it, every `GITOPS_POLL_MIN_INTERVAL_MS`, for ever.

Because `deployed` is in `NON_TERMINAL_STATUSES` the page keeps showing progress, `verified ->
active` never happens, `gateway.allowedDeployments` never gains the model, and a credential
request answers `409 deployment-not-ready` from `credential-service.js`.

`src/adapters/azure/arm-tenant-resource-verifier.js` already computes a precise reason for all six
failure cases: `environment-not-configured`, `no-resources`, `resource-outside-environment`,
`unsupported-resource-type`, `resource-unavailable`, `resource-not-succeeded`. The first is the
likeliest cause here - a missing `AIP_ENVIRONMENTS` entry - and is invisible today.

Note `verified -> active` itself is fine: `getDeploymentStatus` returns it before the poll-interval
check. The stall is one step earlier. Do not "fix" the activation path.

## What to build

Follow R6 items 1 to 6. In short: keep the reason, persist it, bound the retries so repeated
failure becomes terminal with that reason on it, audit and log each failure, surface it honestly on
the wait page and team page, then return and render the verified resource list from
`gitops.resources` (name and kind only - never a subscription id, full resource id or secret), with
an "app registration skipped, awaiting Entra consent" line derived from the environment's
`entra.enabled` and `entra.teamRegistrations`.

Item 6 matters beyond this phase: carry the team app registration identifiers from the same run
report outputs onto the team record. Phase 5's B18 Graph issuer needs the registration's object id
and must not look it up by display name.

Decide and record the retry bound in the plan's dated notes.

## Constraints

- Follow each repo's `.github/copilot-instructions.md`. Tests colocated as `<file>.test.js`.
- A bug fix ships with a regression test that fails without the fix. The discarded-reason path has
  no test today - that is the one to write first.
- Any new persisted field follows `schema-changes.instructions.md`: a dated backfill using an
  aggregation-pipeline `updateMany`.
- Never show raw GitOps status names to a person.
- On Windows run tests with `$env:TZ='UTC'` (and `$env:AWS_EMF_ENVIRONMENT='Local'` for the
  frontend) then `npx vitest run` - `npm test` uses Unix env syntax.
- Before finishing: `npm run format`, then `format:check`, `lint` and `test` pass in both repos.

## Done when

A deployment whose environment is missing from `AIP_ENVIRONMENTS` reports
`environment-not-configured` on the page instead of spinning; a healthy team reaches `active` and
lists its real resources; the team record carries the app registration identifiers.

Then update `docs/implemented-features.md` and add a dated note to the plan.

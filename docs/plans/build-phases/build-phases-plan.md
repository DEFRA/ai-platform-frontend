# Build stories B01–B22: phased delivery

> Cross-cutting plan, not a journey route. See also the
> ["three routes to a credential"](../../ui-flow-three-routes.md) journey
> ([Route 0](../route0-welcome-plan.md), [Route 1](../route1-plan.md), [Route 2](../route2-plan.md),
> [Route 3](../route3-plan.md)) and the other cross-cutting plans,
> [centralised-gateway-plan.md](../centralised-gateway/centralised-gateway-plan.md) and
> [research-tier-integration-plan.md](../integration/research-tier-integration-plan.md).
>
> **STATUS: IN PROGRESS (14 Oct 2026).** Phase 3 and the backend half of Phase 4 exist as code on
> the ten open pull requests listed below. Nothing is merged, released or applied, so no story's
> built state has changed and Phase 0 is still next. Update the `Status` line on each phase as it
> lands and add a dated note at the bottom recording what actually happened versus what is
> written here.

## Authoritative source

`ai-platform-discovery-docs` at `main` = `4d007d7`, the **PR #20 merge commit**
(`docs/naming-and-full-spec`, merged 13 Oct 2026), on top of the PR #19 merge commit `2c0db5c`
(`feature/observability`) and the PR #18 merge commit `76a4e1a` (`docs/iac-baseline-direction`),
both also merged 13 Oct 2026.

PR #19 added design G, diagram G1, AR06 and stories B20–B22. PR #20 then overrode any earlier
wording that left names or public access open: Azure and AWS names come strictly from CCoE's
naming policy (`apim-aip-{env}` and the rest are **logical labels only**), every component in a
live consumer environment and in SSV3/SSV5 is private and fully secured from its first resource,
public access is allowed only in the Phase 1 Infradev and Sandbox proof and ends at the gate
before DEV, and three named exceptions carry owners and end dates — **X1** CDP egress through the
tenants vault firewall, **X2** public apply endpoints until private runners exist, **X3** public
Application Insights ingestion from CDP and GitHub.

Open PR [#21](https://github.com/DEFRA/ai-platform-discovery-docs/pull/21)
(`docs/iac-baseline-decisions`) adds four dated 14 Oct 2026 entries — the workflow review, audit
identity and submit findings, the identity and credential answers, and the team tier, parameters
and first proof. **This plan already follows them**; re-check them when that PR merges. Line
numbers quoted in Phase 0 were taken on the post-#19 tree and PR #20 moved some of them — verify
each before editing.

| Reference                                                                                                               | What it mandates                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [design-teams.md](../../../../ai-platform-discovery-docs/src/content/design-teams.md)                                   | Design F, PR #18. AI Platform teams separate from CDP teams; Admin and Member; creator is first Admin; a team always keeps an Admin; several teams per person; three-character service code                                                                                                                                |
| [design-observability.md](../../../../ai-platform-discovery-docs/src/content/design-observability.md)                   | Design G, new in PR #19. OpenTelemetry and a W3C trace beside CDP's `x-cdp-request-id` on every hop; Log Analytics backs every signal per environment; no collector in the first build; Azure Managed Grafana in SSV3/SSV5 with dashboards and alerts as code; `audit.capturePrompts` off by default, on only after a DPIA |
| [docs/iac-baseline-plan.md](../../../../ai-platform-discovery-docs/docs/iac-baseline-plan.md)                           | D1–D16, workstreams WS0–WS7, milestones M1–M7, robustness controls R1–R12, the team-file schema and the `submit` contract (PR #18). PR #19 adds Application Insights and diagnostic settings to the `log-analytics` module and defers the rest of observability to B20–B22, required at the gate before DEV                |
| [docs/decision-history.md](../../../../ai-platform-discovery-docs/docs/decision-history.md)                             | The two 12 October entries (IaC baseline direction, teams and gateway tier), the 13 October observability and CCoE naming/full-specification entries, and the four 14 October entries on open PR #21                                                                                                                       |
| [design-repositories-pipelines.md](../../../../ai-platform-discovery-docs/src/content/design-repositories-pipelines.md) | Design B. The five repositories, the registry and layered parameters, the workflows and their rulesets, the GitHub Environments and the release mechanics                                                                                                                                                                  |
| [design-identity.md](../../../../ai-platform-discovery-docs/src/content/design-identity.md)                             | Credential rules and lifetimes, CDP Web Identity trust, caller identities                                                                                                                                                                                                                                                  |
| [design-environments.md](../../../../ai-platform-discovery-docs/src/content/design-environments.md)                     | Environment names and the Phase 1 progression through `SND1` then `SND4`                                                                                                                                                                                                                                                   |
| [build-stories.md](../../../../ai-platform-discovery-docs/src/content/build-stories.md)                                 | Now twenty-two stories (B01–B22) — B20–B22 (observability) added in PR #19 — with flows and acceptance criteria                                                                                                                                                                                                            |

## Open pull requests (14 Oct 2026)

Ten pull requests carry Phase 3 and the backend half of Phase 4. **None is merged**, so built
state is unchanged everywhere. The infra three and the two state-repository callers are stacked
and must merge in order.

| Pull request                                                                              | Carries                                                                                                                     | Phase, milestone             |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| [infra #5](https://github.com/DEFRA/ai-platform-infra/pull/5) `feature/gitops-contract`   | WS1 `v0.3.0` — four schemas, `aip-checks`, `examples/`, team tier catalogue, `docs/gitops-contract.md`                      | Phase 3, M1                  |
| [infra #6](https://github.com/DEFRA/ai-platform-infra/pull/6) `feature/platform-baseline` | WS2 `v0.4.0` — `naming`, `roles`, platform modules, `platform/`, `names/`, `bootstrap/`                                     | Phase 3, M2                  |
| [infra #7](https://github.com/DEFRA/ai-platform-infra/pull/7) `feature/tenant-modules`    | WS2 `v0.5.0` — `modules/team`, `apim-team-api`, `entra-team-app`, `tenants/`                                                | Phase 3, M3 and M4           |
| [workflows #1](https://github.com/DEFRA/ai-platform-workflows/pull/1)                     | WS3 `v1.0.0` and `v1` — nine reusable workflows, `setup` and `gitops` actions, Octokit modules and scripts, 145 tests       | Phase 3, all                 |
| [environments #1](https://github.com/DEFRA/ai-platform-environments/pull/1)               | WS1 config — `registry.json`, `global.tfvars.json`, `environments/infradev/platform.tfvars.json`                            | Phase 3, M1                  |
| [tenants #1](https://github.com/DEFRA/ai-platform-tenants/pull/1)                         | WS4 callers — `submit`, `validate`, `apply` (`state: tenants`), `prune`                                                     | Phase 3, M3–M5               |
| [deployments #1](https://github.com/DEFRA/ai-platform-deployments/pull/1)                 | WS4 callers — `submit`, `validate`, `apply` (`state: platform`), `prune`                                                    | Phase 3, M2                  |
| [backend #35](https://github.com/DEFRA/ai-platform-backend-api/pull/35)                   | WS5 — GitHub App client, `TenantOrchestrator`, `TenantResourceVerifier`, D14 policy, R11 polling, `entra:{oid}` attribution | Phase 4, M6 (blocked on WS6) |
| [frontend #35](https://github.com/DEFRA/ai-platform-frontend/pull/35)                     | Phase 4 item 8 — submit run, pull request and apply run links on the team request page                                      | Phase 4                      |
| [discovery-docs #21](https://github.com/DEFRA/ai-platform-discovery-docs/pull/21)         | The four 14 Oct direction entries this plan now follows                                                                     | Direction only               |

**What is left is configuration and consent, not code.** Reviewed against the branches on
14 Oct 2026, the prepared repositories hold no TODOs, no skipped tests and no unimplemented
workflow steps; the placeholders in `ai-platform-environments` have all been filled
(`entra.tenantId`, the publisher email — still a person's address rather than a shared mailbox —
and `identities.portal_api_principal_object_id`), and `azure.existing_resource_group` is set to
`SNDAIEAIPRGP1401`. The outstanding prerequisites are:

| #   | Prerequisite                                                                                                                        | Blocks                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | User Access Administrator (or RBAC Administrator) on `SNDAIEAIPRGP1401`                                                             | `bootstrap`, so M2 onwards     |
| 2   | Entra admin consent for `Application.ReadWrite.OwnedBy` on the deploy identity, and on the backend identity for secrets             | M3, M4, M7 — every team proof  |
| 3   | GitHub Environments `infradev`, `gitops-writer`, `gitops-reader`, `gitops-dispatch` and `release`, with the App key and OIDC values | Every workflow run             |
| 4   | Repository variables `GITOPS_APP_CLIENT_ID` and `AZURE_TENANT_ID` in both state repositories                                        | Every workflow run             |
| 5   | Branch rulesets requiring `validate-desired-state / validate`, no App bypass, App limited to `environments/infradev/**`             | WS4 proofs M2–M5               |
| 6   | A shared mailbox for the API Management publisher                                                                                   | Nothing today; tidy before DEV |

## Built versus remaining, at a glance

| Phase | Built (on the branches above)                                                                                                                                                                                                                 | Remaining                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0     | —                                                                                                                                                                                                                                             | All of it: restructure `build-stories.md`                                                              |
| 1     | CodeQL and checkov wired in the new repositories; `aip-checks` and workflows carry 90/90/85/90 coverage thresholds                                                                                                                            | Portal coverage thresholds, axe scans, no-JavaScript journeys, `AUTH_MODE`, the `azure` alias removal  |
| 2     | **Team `slug`** (derived, immutable, backfilled, shown as "Team ID") and **`serviceCode`** (required, three characters, admin-changeable, verifier port), `entra:{oid}` attribution, the `oid`+`tid` unique index, the non-unique email index | Demotion guard, `currentTeamId`, the environment list, a real service code verifier                    |
| 3     | WS1–WS4 in full: schemas, 11 `aip-checks` commands, 12 modules, 4 roots, 11 workflows, 2 actions, callers, parameters                                                                                                                         | Merge in order, run `bootstrap`, then prove M2–M5 in Infradev                                          |
| 4     | WS5 and WS6 in full: orchestrator, ARM verifier, D14 policy, queueing, polling, admin retry/reconcile, the desired-state builder, run links in the portal                                                                                     | Prove M6 against Infradev once Phase 3 is applied; the environment list                                |
| 5     | Gateway-side limits and the OAuth-only team API; Terraform-owned registrations and federations                                                                                                                                                | The portal's limits page and increase flow; the backend's Graph client-secret issuer; federation entry |
| 6     | —                                                                                                                                                                                                                                             | All of it                                                                                              |
| 7     | `trace_parent` and the `Traceparent` trailer in the contract; Application Insights, W3C APIM diagnostics, token metrics                                                                                                                       | The OpenTelemetry SDK both sides, `capturePrompts`, Grafana, dashboards, alerts, runbooks              |

## Direction that changed on 13 and 14 October 2026

Each item below reshapes a phase; the phase text carries the detail.

1. **Team tier is OAuth only.** `gateway.credentialType` allows only `oauth`; every team that is
   not `removed` has a registration and its API takes a token, never a subscription key.
   Subscription keys remain research-tier only. Design C's per-team choice is withdrawn. This
   moves work from Phase 5 (B18) into Phases 3 and 4 — a team cannot get a working credential
   without it.
2. **No resource names in a team file.** `project.name` and `deployments[].deploymentName` are
   gone; `gateway.allowedDeployments` lists catalogue slugs, which the gateway policy maps to the
   derived `{slug}-{model}`. Phase 4's desired-state builder emits this shape.
3. **One principal per change.** `Requested-By`, `updatedBy` and `requestedBy` hold
   `entra:{oid}`, `github:{user id}` or `app:{name}`, checked by the schemas; `submit` refuses a
   document whose attribution differs from the requester.
4. **One required check, one apply workflow.** `validate-desired-state / validate` replaces
   `validate / {env}`; `apply-state.yml` with a `state` input replaces the two apply workflows;
   actions are referenced by major tag, not SHA; the App has no ruleset bypass.
5. **Layered parameters.** `global.tfvars.json` plus `environments/{env}/platform.tfvars.json`,
   shared codes at the top level and everything Azure under `azure`; `aip-checks params`
   deep-merges and validates the result.
6. **CCoE naming and full specification** (PR #20) — names in this plan are logical labels;
   public access is a time-boxed Phase 1 proof concession with exceptions X1–X3.
7. **New Azure limits to design within**: 32 model deployments per Foundry account, and about 250
   Entra objects per creating principal, so each environment's deploy identity permanently
   deletes the registrations it removes.

## Status vocabulary

`Implemented`, `Partial — <what remains>`, `Proposal`. Section `Status:` lines in
`build-stories.md` use the site's closed vocabulary; the story-map **column** carries the
three values above.

---

## Phase 0 — Restructure `build-stories.md`

**Status: not started.** Repository: `ai-platform-discovery-docs` only. No dependencies.

Delete the `#status` section, fold its detail into a Status column on `#story-map` plus a dated
built-state line in each story section.

### Extend the status vocabulary

`Status:` lines are validated by a closed regex, so `implemented` must be added in seven places:

| File                          | Line                     | Change                                         |
| ----------------------------- | ------------------------ | ---------------------------------------------- |
| `scripts/build.js`            | 72                       | add `implemented` to the alternation           |
| `scripts/manifest.js`         | 34–39 (`statuses`)       | add `implemented: { label, basis }`            |
| `src/assets/site.css`         | after 459                | add `.tag--implemented` beside the other four  |
| `src/content/overview.md`     | 92–106 `#status-meaning` | add an Implemented badge row                   |
| `test/site.test.js`           | 624                      | `Object.keys(statuses).sort()`                 |
| `test/site.test.js`           | 625                      | `Object.values(statuses).map(s => s.label)`    |
| `test/browser/review.spec.js` | 715                      | `expect(Object.keys(statuses)).toEqual([...])` |

The `implemented` basis text must say built in the named repository at the stated version — not
accepted, not deployed. All of P01–P13 remain unexecuted.

### Rewrite the story map and remove `#status`

1. `#story-map` columns become `Story | Title | Status | Repositories | Maps to | Depends on`.
   The section's own `Status:` line stays `proposal`.
2. Carry the four `#status` narrative blocks under the table as short prose: the dated versions
   preamble, "Built outside a numbered story", "Real Azure so far", and the gaps list. Re-verify
   each gap first — gap 1 claims it was fixed from `0.22.0`; gap 2 is Phase 3; gap 3
   (`id-aip-backend-{env}`) is iac plan D5, so it is Phase 3; gap 4 is Phase 4; gap 5 is Phase 5.
3. Delete `## Build status on 9 October 2026 {#status}`.
4. Each `## B01 … ## B22` keeps `Present: skip` and gains one line dated the day Phase 0 lands:
   `Built state on {date}: built | partial | not started.` — sourced from the
   "Differs from the story" column being removed. Partial stories use `Status: proposal`, since
   the vocabulary has no `partial`. B20–B22 (PR #19) have no "Differs" entry yet — mark them
   `not started` until Phase 7 lands. Re-read B07, B09, B15 and B16 at the time: all four change
   the moment the prepared pull requests merge, and until then none of them has.
5. Update the `build-stories.md` frontmatter `description`, which promises a build-status section
   that will no longer exist.

### Repoint the inbound links

**17 live locations across 13 files**, verified by grep on the post-#18 tree and **to be
re-verified**: PR #20 rewrote several of these pages on 13 October.
`build-stories.md` 11, 846 · `architecture.md` 263 · `backlog.md` 13, 478, 533 ·
`design-environments.md` 127 · `design-identity.md` 62 · `design-infrastructure.md` 49 ·
`design-orchestration.md` 210 · `hld-designs.md` 24 · `scope.md` 39 · `README.md` 23 ·
`docs/decision-history.md` 39 · `docs/iac-baseline-plan.md` 20, 237 · `docs/design-pack-plan.md` 48.

Leave the 11 dated locations: `decision-history.md` 495, 528, 544, 545, 547, 563, 576, 614 and
`design-pack-plan.md` 77, 90, 96. That repository's rule is that dated entries are never rewritten.

`dist/*.html` holds the same links — build output, regenerate rather than hand-edit.
`src/data/cloud-designs.json` is **not** affected: its AR records link only to `#b15`, `#b08` and
`#b16`, so the AR `version`/`history`/`reviewedOn` rule does not apply.

### Tests and record

- `test/browser/review.spec.js:856` — drop `status` from the section-id list and extend the
  override map with every implemented story.
- `test/site.test.js:2008-2031` — replace the thirteen `#status` assertions (2022 pins exactly 13
  table rows) with `#story-map` ones: the Status column header, one Implemented, one Partial and
  one Proposal row, a 22-row count, built-state `assertCopy` on B01/B09/B15, and
  `assert.doesNotMatch(/Build status on 9 October 2026|Differs from the story/)` page-wide.
  Read the whole block first — PR #18 added 796 lines to this file and PR #20 added more.
- `ms.date` set to the day Phase 0 lands on every Markdown file touched.
- Append a dated `decision-history.md` entry with a `Topic | Direction | Site consequence` table,
  update the "Direction in force" built-state row, and add `Delivered on 13 October 2026` to
  `design-pack-plan.md`.

**Verify:** `npm run lint`, `npm test`, `npm run check`.

---

## Phase 1 — Quality gates, journey harness, config cleanup

**Status: not started.** Stories B01, B02. Repositories: frontend, backend, journey-tests.
No dependencies — runs in parallel with Phases 2 and 3.

1. Re-verify B01's three stale claims. SonarCloud and Dependabot **are** configured in both
   repos, contrary to the 9 October table; correct the built-state note.
2. Coverage thresholds in both `vitest.config.js` — neither has any today. Use the
   working-agreements figures: 95% statements, lines and functions, 90% branches. Raise to actual
   if already higher; never decrease.
3. Confirm the SonarCloud quality gate blocks rather than advises. The GitOps repositories set
   their own bar in Phase 3 — CodeQL default setup on both public repositories and a checkov
   `security` job reporting to code scanning, soft-failing only until the Phase 1 baseline
   findings are triaged. Triaging them and removing the soft-fail belongs here, after Phase 3
   merges.
4. **Refactor:** remove the deprecated `azure` alias for `provisioning.mode` —
   `config.js:194`, the branch at `:380`, and `config.test.js:40`.
5. Journey tests: axe scan at WCAG 2.2 AA on every page a journey visits, failing on any
   violation. The repository is populated already (`test/specs/pre-signin/`,
   `test/specs/post-signin/`), contrary to the 9 October table.
6. One no-JavaScript journey per user-facing story — B06, B07, B08, B09, B10.
7. `AUTH_MODE=entra|stub` in the frontend with a production guard. `azureAd.mockIssuerUrl`
   already has an `!isProduction` guard at `src/config/config.js:263` — reuse that pattern.
8. `journey-` prefixed test data removed by a maintenance call; seeded catalogue read-only.

**Verify:** both repos `format:check && lint && test` green at the new thresholds; a deliberate
axe violation fails a journey; the production guard has a unit test.

---

## Phase 2 — Complete and correct the team model

**Status: not started, and now on the critical path.** Stories B13, B14. Repositories: backend,
frontend. Depends on B08 (built). Parallel with Phases 1 and 3. Row 1, the team `slug` Phase 4
needs, is **done on the two portal branches**; the rest is unstarted.

Two decisions settled on 14 Oct 2026 and built that way: the slug is **derived from the team
name**, not typed by an Admin — GOV.UK guidance is not to ask for what can be derived, and a
permanent public identifier someone typed in a hurry is a support burden; a clash takes a
numbered suffix. And a **rename never changes the slug**, because it names the team's GitOps
file, its gateway path and its deployments; the team page says so, and any future rename screen
must repeat it.

Mostly refactor. Design F contradicts parts of what is built, and more is already built than the
9 October table says — `last-admin`, member removal and multi-team membership all exist.

|     | Design requires                                                               | Built today                                                                                                                                                      | Action                                                                                             |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Immutable unique team `slug`, `^[a-z][a-z0-9-]{1,22}[a-z0-9]$` (iac plan WS6) | **Done on the branches**: derived from the name in `createTeam`, numbered on a clash, unique index, `2026-10-14-add-team-slug` backfill, shown as "Team ID"      | Nothing — Phase 4's builder can use `team.slug`                                                    |
| 2   | `serviceCode` three characters, required, verified (design F, R01)            | **Done on the branches**: required and `^[A-Z0-9]{3}$` on create, `PATCH /v1/teams/{id}` for an admin, and a `ServiceCodeVerifier` port with a mock              | Replace the mock when a CDP/CCoE source is agreed, and add the prod mock-refusal guard then        |
| 3   | Interface says Admin and Member; stored values stay `admin`/`user`            | Stored correctly; check frontend copy for "User"                                                                                                                 | Copy change only — do not migrate stored values                                                    |
| 4   | Last Admin can never be demoted **or** removed                                | Removal guard exists — `last-admin` 409 at `team-service.js:349-360`                                                                                             | Add `PATCH /v1/teams/{id}/members/{memberId}`; extend the existing guard to demotion               |
| 5   | A person acts in one team at a time                                           | Multi-team membership built; session holds only `pendingTeam`/`pendingAccess`                                                                                    | Add `currentTeamId` to the `@hapi/yar` session and a switcher                                      |
| 6   | SND1 is `infradev`; configurable `AIP_ENVIRONMENTS` (iac plan D1)             | `AIP_ENVIRONMENTS` exists for ARM verification (backend PR #35), but `const TEAM_FACING_ENVIRONMENT = 'sandbox'` still stands at `team-deployment-service.js:40` | Drive the team-facing list from the same config; the frontend option comes from the backend        |
| 7   | Every change attributable to one principal (14 Oct)                           | **Done in backend PR #35**: `entra:{oid}` on every GitOps change, a unique `oid`+`tid` index, and a deliberately non-unique email index                          | Nothing to build — keep the "never look a person up by email" rule when touching `user-service.js` |

Keep `sandbox` in the list rather than migrating existing `teamDeployments` — design A runs
Phase 1 in `SND1` **then** `SND4`, so both stay live.

Role changes go under a `server.locker` lock on the team and are audited. Settle before coding:
may an Admin leave a team they are the last Admin of by promoting someone in the same step?

**Verify:** unit, integration and one journey per user-facing change; a demotion `last-admin` 409
regression test; a backfill test proving a slugless legacy team is handled; update
[implemented-features.md](../../implemented-features.md).

---

## Phase 3 — IaC baseline, GitOps path in Infradev

**Status: in progress — code prepared, nothing merged or applied.** Story B15. Repositories:
`ai-platform-infra` and `ai-platform-workflows` (public), `ai-platform-environments`,
`ai-platform-tenants` and `ai-platform-deployments` (internal). No dependencies.

WS1 to WS4 all exist on the seven open pull requests listed above; what remains is the WS0
prerequisites, merging in order (infra #5 → #6 → #7, then workflows #1, then the three config and
state repositories), and running M2 to M5 in Infradev. Follow
[docs/iac-baseline-plan.md](../../../../ai-platform-discovery-docs/docs/iac-baseline-plan.md) —
do not re-derive it.

- **WS0** prerequisites, **the real blocker** — the six rows in the prerequisite table above,
  plus confirming Defra Policy allows the names, public network access, Developer APIM, UK South
  and Sweden Central, quota for the team model SKU, and OIDC token refresh during the long APIM
  create.
- **WS1** infra `v0.3.0` (PR #5) — `team`, `pin`, `registry` and `environment` schemas, the
  `aip-checks` CLI (`catalogue`, `tenants`, `tenants-on-main`, `pins`, `pin-on-main`,
  `environments`, `params`, `plan-guard`, `run-report`, `teams-variables`, `canonical`),
  `examples/`, `docs/gitops-contract.md`, and the `team` tier on **`gpt-5-nano`** as
  `DataZoneStandard` in Sweden Central (it is not offered as Standard in UK South), with
  `capacityPolicy.environments.infradev.quota` of 10 capping the sum across teams. The schemas
  enforce the OAuth-only `credentialType`, the slug pattern, the principal pattern and
  `entra.createdObjectLimit`; `team-rules.js` enforces 32 deployments per Foundry account.
  `ai-platform-environments` (PR #1) holds `registry.json`, `global.tfvars.json` and
  `environments/infradev/platform.tfvars.json` — shared codes at the top level, everything Azure
  under `azure`, deep-merged and validated by `aip-checks params`. D13: public code, private
  config.
- **WS2** `v0.4.0` (PR #6) and `v0.5.0` (PR #7) — `naming` (CCoE's pattern, service code `AIP`),
  `roles` (the only place a built-in role GUID appears), `log-analytics` (with Application
  Insights, local authentication off, and diagnostic settings for APIM, Foundry and both vaults;
  LLM message logging off — the rest of observability, Grafana and alerts, is Phase 7),
  `key-vault`, `apim`, `foundry-account` (**one per region**, UK South primary and Sweden Central
  for EU Data Zone team models), `entra-api-audience`, the team modules (`foundry-project`,
  `foundry-deployment`, `apim-team-api`, `entra-team-app`) and `modules/team`. Root modules are
  `platform/` and `tenants/` (D12 renames design B's `team/`), plus `names/` and `bootstrap/`.
  The tenants root refuses a release the platform has not applied (R5) and validates `teams`
  against the schema (R9); `prevent_destroy` on core resources.
- **WS3** workflows `v1.0.0` and a moving `v1` (PR #1) — `submit-desired-state`,
  `validate-desired-state`, `validate-environments`, `apply-state` (`state: platform` or
  `tenants`), `infra-checks` (with a soft-failing checkov `security` job into code scanning),
  `release`, `release-merge`, `workflow-checks`, `prune-op-branches`; two composite actions,
  `setup` and `gitops`; GitOps logic in tested Octokit modules and shell scripts, never inline.
  D11: exact-pinned Terraform 1.16.5 with committed lock files, checks in Node 24 ESM, actions
  referenced by major version tag, `X-GitHub-Api-Version: 2026-03-10` pinned; the major tag moves
  through the Git refs API, because the App holds no Workflows permission.
- **WS4** state repositories (tenants #1, deployments #1) — thin `submit`, `validate`, `apply` and
  `prune` callers, rulesets (PR required, 0 approvals, required `validate-desired-state /
validate`, no App bypass — the App reaches `main` only through auto-merge — App limited to
  `environments/infradev/**`), the GitHub Environments and a README break-glass. `ai-dev-team`
  stands in for `aice-platform-engineers` and `aice-platform-admins` until they exist.
- **D2 public minimal platform** in SND1: `rg-aip-infradev-platform`, `apim-aip-infradev`
  (**Developer tier** for the proof, SKU from `platform.tfvars.json` — data, not code),
  `aif-aip-infradev`, `kv-aip-infradev-platform`, `kv-aip-infradev-tenants`, `law-aip-infradev`,
  `appi-aip-infradev` — **logical labels; the real names come from CCoE's policy through the
  `naming` module** (PR #20). No VNet, Redis, private endpoints or policy assignments. D15:
  Premium v2 with virtual network injection is the target for live consumer environments, not this
  proof. The first proof runs inside the **existing** resource group `SNDAIEAIPRGP1401` in
  `AZR-AIE-SND1` through `azure.existing_resource_group` (allowed only for the platform-test and
  sandbox classes), with the subscription activity log off and bootstrap's role administration
  scoped to that group.
- **D5 identities**: GitHub App `ai-platform-orchestrator` (GitHub only),
  `id-aip-deploy-infradev` (federated only, no secret, on GitHub's **immutable** OIDC subjects
  `repo:DEFRA@{org-id}/{repository}@{repo-id}:environment:infradev`),
  `id-aip-backend-infradev` federated from the CDP `dev` backend role. The sandbox pair federates
  from the CDP `test` role. **Closes deployment gap 3.**
- **Closes deployment gap 2** — the hand-configured `research` API and its end-date policy move
  into the `platform` module.
- **Team tier is OAuth only** (14 Oct): `apim-team-api` runs `aip-authorise` for every team,
  `tenants/` refuses any `credentialType` but `oauth`, and callers name a catalogue slug that the
  policy rewrites to the derived `{slug}-{model}`. No team subscription keys anywhere.

Three gaps are deliberate in the prepared code, and each belongs to a later gate rather than to
this phase: the private topology is accepted by the schema but **not implemented** by the
`platform` root (`environment-rules.js` warns, and the rebuild is the gate before DEV); the
checkov `security` job soft-fails until the Phase 1 baseline findings are triaged (Phase 1); and
`team-rules.js` refuses a shared Research deployment in `allowedDeployments`, so a team's grant
of a shared research model is not built yet.

The GitHub side of WS4 \u2014 Environments, repository variables and the branch rulesets \u2014 is
described in the READMEs but must be configured by hand before any workflow run; that is rows 3\u20135\nof the prerequisite table.

**Verify:** M2 an infra merge reaches SND1 through release-please and pin with no manual step,
the App merging the green release pull request; M3 a synthetic OAuth team using a client secret
calls its granted model and a non-granted model returns 403; M4 a federated OAuth team's
registration and credential arrive through GitOps and a foreign token is refused; M5 proves
robustness controls R1–R4 and R6.

---

## Phase 4 — Team provisioning through GitOps

**Status: in progress — WS5 and WS6 prepared in backend PR #35 and frontend PR #35.**
Story B16; closes B09 and deployment gap 4. Repositories: backend, frontend. Depends on Phase 3.
Blocks Phases 5 and 6. Follows iac plan WS5 and WS6, M6 and M7, D3, D6 and D14.

The async lifecycle already existed against the mock, and backend PR #35 reshapes it onto the
GitOps contract and builds the document the contract wants. **What is left is running M6 against
Infradev**, which needs Phase 3 merged and applied.

Built in the open pull requests:

1. A shared GitHub App client minting a down-scoped installation token per use, with
   `X-GitHub-Api-Version: 2026-03-10`.
2. The reshaped port: `requestDeployment` dispatches `submit.yml` with the whole canonical
   document (byte-identical to `ai-platform-infra`'s serialisation, refused at 60 KB);
   `getDeploymentStatus` walks the contract's state table through the pull request, the required
   check `validate-desired-state / validate`, the GitHub Deployment and the run report, then ARM
   verification through a separate `TenantResourceVerifier` port.
   `TENANT_ORCHESTRATOR=mock|github` with production refusing `mock`, and one contract suite run
   against both adapters.
3. Config: `TENANT_ORCHESTRATOR`, `GITOPS_TENANTS_REPO`, `GITOPS_DEPLOYMENTS_REPO`,
   `GITOPS_POLL_MIN_INTERVAL_MS`, `GITOPS_CLAIM_LEASE_MS` and `AIP_ENVIRONMENTS` (the
   subscription, resource group, APIM, Foundry accounts and tenants vault ARM verification will
   accept per environment).
4. R11 polling — conditional ETag requests, a minimum interval, backoff, non-terminal operations
   only, a maintenance sweep for operations nobody is watching, and an audit event per transition.
5. The D14 failure policy — one fresh apply dispatch, then an attributed revert or an engineer
   alert; `abandon` on `checks-failed`; a failed revert is audited and alerted, never retried, and
   its pull request stays open, keeping the file locked, until an engineer acts.
6. One operation in flight per team file (`file-locked`): a later request is stored as `queued`
   and builds its document when it is dispatched, and the frontend says so.
7. `entra:{oid}` attribution on every submission, and Platform Admin `retry`/`reconcile` routes.
8. The frontend shows the submit run, pull request and apply run under "Details for the AI
   Platform team", https only, keeping the safe failure message.
9. **WS6**: `team-desired-state.js` builds the whole team file from what `main` holds now — the
   model added to `deployments[]` (catalogue team SKU, that environment's default capacity) and to
   `gateway.allowedDeployments`, `revision` incremented, and the team's federations, external
   clients and agreed limits carried over untouched. `getCurrentDocument` on the orchestrator port
   reads the file; a team with no file starts at revision 1 with the configured default limits.

Still to do:

1. Drive the team-facing environment from `AIP_ENVIRONMENTS` rather than the `sandbox` constant.
2. **Gap 4** is now closed differently: with an OAuth-only team tier there is no team subscription
   key to scope, so the `MOCK_TIERS=team` workaround ends when a gateway issues team OAuth client
   secrets — that is M7 and Phase 5's B18, not this phase. Until then `live` mode answers
   `501 gateway-not-enabled` and the wait page explains it.
3. Legacy people have no Entra `oid` until their next sign-in, and `requireUserPrincipal` refuses
   them with `403 entra-identity-required`. Check this is acceptable for invited members who have
   never signed in, and cover it in a journey test.
4. Prove it end to end once Phase 3 is applied: M6 locally with `TENANT_ORCHESTRATOR=github`.

Keep the mock for local runs and journey tests.

**Verify:** M6 a local backend with `TENANT_ORCHESTRATOR=github` reaches `active`, failures show
links, retry, reconcile and revert all work; M7 a team created in the portal gets a working
dedicated model credential in Infradev; the production mock-refusal guard has a test.

---

## Phase 5 — Limits and secretless production credentials

**Status: not started.** Stories B17 and B18. Repositories: backend, frontend. Depends on
Phase 4. The two stories are independent of each other — run them in parallel. **B18 is no longer
optional polish**: since the team tier is OAuth only (14 Oct), no team gets a working credential
until it lands, so it completes M7 and retires `MOCK_TIERS=team`.

### B17 quotas, rate limits and increase requests

Phase 3 applies the enforcement: `apim-team-api` already carries request and token limits per
team and the model allow-list, the team file requires `gateway.limits.tokensPerMinute` and
`requestsPerMinute`, and `capacityPolicy.environments.{env}.quota` caps the sum across teams.
What is missing is the portal half — and note the WS6 builder must emit sensible defaults for
those limits before this story starts.

1. `llm-token-limit` values in the team file within the catalogue's `capacityPolicy`; the gateway
   enforces them per team through the team's API policy.
2. A team limits page. An Admin requests an increase: within platform bounds it applies
   automatically through GitOps, beyond them the platform team reviews and the current limit
   stays in force meanwhile.
3. A caller over its limit receives 429 with a retry hint.
4. Agree the per-environment bounds and how the review is recorded before coding.

### B18 OAuth credentials for team applications

Terraform creates `app-aip-{env}-{slug}`, its service principal and its federated credentials
(infra PR #7), owned by the deploy and Portal API identities, and **deliberately ignores the
`password` and the service principal's `account_enabled`**, and sets the team API's access-window
named value to `none` and never touches it again. Those three are the Portal API's, and they are
the work below. It needs Entra admin consent for `Application.ReadWrite.OwnedBy` on the backend
identity.

1. Issue and rotate a real client secret on the team's registration through Graph, replacing the
   mock issuer's stand-in secret and the `501 gateway-not-enabled` refusal in `live` mode —
   **this is what closes deployment gaps 4 and 5 and removes `MOCK_TIERS=team`**. Enabling,
   suspending and expiring a team's access means writing the APIM access-window named value and
   flipping `account_enabled`, not editing Terraform's resources.
2. Prove the CDP Web Identity exchange end to end. Issuer, subject and audience must match the
   federated credential **exactly** — no wildcard or flexible matching.
3. One app registration per team per environment, shared by all that team's applications, up to
   **20** federated credentials and 39 external clients in the schema. An Azure-hosted
   application uses its user-assigned managed identity as one of them; the managed identity never
   holds the team's access itself.
4. `oauth.federations[]`, `oauth.externalClients[]` and `oauth.secretsAllowed` in the team file,
   written through the WS6 builder. A Member enters only the CDP service name — Terraform derives
   the issuer, the subject `arn:aws:iam::{account}:role/{service}` and the audience from the
   environment's registry entry, so the file promotes unchanged. Any Member may add one, only an
   Admin changes or removes one; applied through GitOps and pending until verified.
5. Enforce the credential rules: federation required in PREPROD and PROD where the host can
   federate; a client secret at most three months and three at once in DEV and QA, at most a year
   in PREPROD and PROD and only where federation is impossible; subscription keys stay research,
   development and testing only, Research keys at most a week (built as the 7-day TTL).
   **Never fall back to a key after an OAuth denial.** An Entra application management policy may
   back the secret rules later, if Defra's licensing allows.
6. Suspension disables the registration in Entra and blocks it at the gateway; renewal re-enables
   both.
7. Environment isolation and the Entra object limit: a registration, its federations, secrets and
   access window serve one environment only; each tenants apply **permanently deletes** the
   registrations it removed from Entra's deleted items, and the checks refuse OAuth teams past
   the registry entry's `entra.createdObjectLimit` (250 by default). Confirm with Defra's Entra
   team whether the limit can be raised before the estate nears 100 teams per environment.

**Verify:** a federated token calls the team's API and a token from another issuer or account is
refused; a client secret issued by the portal works and a suspended registration is refused
within the token lifetime; a team over its limit is throttled and other teams are not; PREPROD
and PROD refuse a key where federation is possible.

---

## Phase 6 — Team usage and chargeback reporting

**Status: not started.** Story B19. Repositories: backend, frontend. Depends on Phases 2 and 4.

The audit trail exists; no usage or chargeback query does.

1. A usage query joining the gateway log to the team file by team, model, environment and service
   code.
2. A team usage page showing tokens and estimated cost for the period. Members see it; only
   Admins export it.
3. Strict isolation — a team never sees another team's usage through the page or the API, and a
   foreign team identifier is **refused, not hidden**. Security critical: 100% coverage on the
   isolation checks, tested at both the service and route layers.
4. Until the tariff and period are agreed with the chargeback owners, show tokens and label cost
   explicitly as an estimate.

**Verify:** totals reconcile with the gateway log for the period; a cross-team access attempt is
refused, with a test at each layer.

---

## Phase 7 — Observability: telemetry, dashboards and alerts

**Status: not started.** Stories B20, B21, B22 (added by `ai-platform-discovery-docs` PR #19, 13
Oct 2026). Repositories: frontend and backend (OpenTelemetry SDK, correlation, dimensions),
`ai-platform-workflows` (dispatch inputs, span export), `ai-platform-infra` (Grafana, dashboards,
alert rules, runbooks). Depends on Phase 3 (B15); the `submit` dispatch inputs need Phase 4
(B16). B21 depends on B20; B22 depends on B21. **B20 and B22 must both pass in Infradev before
DEV is created** (design G `#stages`) — follow design G and the decision history's 13 October
2026 entry rather than re-deriving them.

### B20 telemetry and tracing foundation

1. Instrument frontend and backend with the OpenTelemetry SDK; carry a W3C `traceparent` on
   every hop **beside** CDP's existing `x-cdp-request-id` — do not replace it, CDP OpenSearch
   search still keys off `trace.id` from that header. Add team, application, flow, API, model and
   environment as span dimensions.
2. The Portal API passes `trace_parent` and `operation_id` to the `submit` dispatch inputs
   (workflows repo); the apply workflow exports its own spans and the run report as the deploy
   identity. The contract already takes an optional `trace_parent` and writes a `Traceparent`
   commit trailer — the backend does not send one yet, so this is the portal half only.
3. APIM's diagnostic settings (the Phase 3 `log-analytics` module, already W3C with no bodies and
   an Entra-authenticated Application Insights logger) carry team, application, model and
   deployment on the gateway and LLM logs. Public Application Insights ingestion from CDP and
   GitHub is the named exception **X3**, whose end date is set at the gate before DEV.
4. **New persisted field:** `audit.capturePrompts` (boolean, default `false`) on the team
   document — follow
   [schema-changes.instructions.md](../../../../ai-platform-backend-api/.github/instructions/schema-changes.instructions.md):
   a dated backfill so an existing team gets the default rather than `undefined`. Pull request
   checks refuse `true` without a DPIA reference.
5. Local runs export to `appi-aip-infradev`. Confirm Entra authentication for the Azure Monitor
   exporter from CDP and GitHub first; until the CDP export route is agreed, verify only the
   portal's own spans in local runs.

### B21 dashboards and search

1. `ai-platform-infra` Terraform creates `amg-aip-nonprod` (SSV3, behind private endpoints per
   PR #20), its managed identity reading Infradev's Log Analytics workspace and Application
   Insights only; `amg-aip-prod` (SSV5) follows later, scoped the same way to production.
2. Dashboards are JSON in the infra repo, applied by Terraform; a playground folder in the
   non-production instance allows hand experiments outside Git, but anything changed by hand
   outside it is reverted by the next apply.
3. Team-facing portal views are **TBC** (design G `#open`) — do not build ahead of agreement.

### B22 alerts and runbooks

1. Alert rules (gateway errors, latency, model capacity, stuck GitOps operations, credential
   expiry, missing telemetry, missing audit capture) as Grafana JSON beside the dashboards, each
   linking an existing runbook in the infra repo.
2. `ag-aip-{env}` action group receives Service Health and Resource Health alerts for the
   environment's resources.
3. Notification channels are **TBC** — alerts show in Grafana meanwhile.
4. This story, with B20, gates DEV creation — treat it as a Phase 1 blocker, not optional polish.

**Verify:** one trace follows a team's portal creation through `submit` and apply to the applied
resources; a team call's gateway and Foundry spans share the caller's trace ID; a forced burst of
gateway 5xx responses and a failed apply in Infradev each raise an alert within the rule's
period; stopping the gateway logs raises the telemetry-missing alert; no span, log, dispatch
input or dashboard holds a secret, token or prompt content; `capturePrompts: true` without a DPIA
reference fails the checks, with a regression test.

---

## Order of work from here (14 Oct 2026)

The phases are not strictly sequential, and three strands can run at once. Step 2 is the long
pole; step 1 unblocks it and needs other people, so raise those requests today.

1. **Request the consents and configure GitHub** (prerequisite rows 1–5). None of it is code and
   all of it blocks a proof: role assignment on the resource group, Entra admin consent, the five
   GitHub Environments, the two repository variables, the two rulesets.
2. **Merge Phase 3 and prove it** — infra #5, #6, #7 in order, then workflows #1 (which releases
   `v1.0.0` and `v1`), then environments #1, deployments #1 and tenants #1. Run `bootstrap` by
   hand once, then M2 (platform through release and pin), M3 and M4 (an OAuth team by scripted
   dispatch, client secret then federated), M5 (R1–R4 and R6). Expect to iterate on Azure policy
   and quota here, not on the code.
3. ~~**Phase 2 row 1 — the team `slug`**~~ — **done on 14 Oct 2026**, on the two portal branches:
   derived in `createTeam`, numbered on a clash, unique index, dated backfill, and shown on the
   team page as "Team ID".
4. ~~**Then WS6, the desired-state builder**~~ — **done on 14 Oct 2026**. Merge backend #35 and
   frontend #35, then run M6 locally with `TENANT_ORCHESTRATOR=github` against Infradev as soon as
   step 2 has applied the platform.
5. **Then B18's Graph client-secret issuer** (Phase 5), which is what finally gives a team a
   working credential and completes M7. Only after M7 does a team journey work end to end in a
   real environment.
6. **Phase 1 and the rest of Phase 2** can be picked up by anyone not on the critical path at any
   point; Phase 0 is a documentation-only afternoon in `ai-platform-discovery-docs` and is worth
   doing while step 1 is waiting on other people.
7. **Phases 6 and 7** follow, except that B20 and B22 gate DEV creation, so start Phase 7's
   telemetry work as soon as Phase 4 is proven rather than leaving it to the end.

Discovery-docs PR #21 can merge whenever; it records direction, not built state. Flip each
`Status` line here as a phase lands, then follow cross-phase rule 7.

---

## Cross-phase rules

1. One branch per story, `feature/<brief-description>`; conventional commits; reviewed PR.
   `main` stays shippable.
2. Every behaviour change ships with tests. Every bug fix ships with a regression test that fails
   without the fix.
3. Before each PR run `npm run format`, then `format:check`, `lint` and `test` must pass.
   Never `--no-verify`.
4. Every external system sits behind a port with a configuration-selected mock; production
   refuses to start with a mock selected. The one exception is `ServiceCodeVerifier`, which has
   no real adapter to select yet — add the guard with the adapter.
5. Any new or renamed persisted field follows
   [schema-changes.instructions.md](../../../../ai-platform-backend-api/.github/instructions/schema-changes.instructions.md)
   — a dated backfill using an aggregation-pipeline `updateMany`, so a document without the field
   is not given a bogus value.
6. Never log or persist a full secret. Reveal only at creation and rotation; `keyHint` elsewhere.
7. On phase completion, in this order: flip this phase's `Status` line here and add a dated note
   at the bottom; update [implemented-features.md](../../implemented-features.md); then open a
   **separate** `ai-platform-discovery-docs` PR that flips the `#story-map` row and the story's
   section `Status:` line, updates the dated built-state note and the gaps list, appends a dated
   decision-history entry and updates the tests. This plan is the only tracker — the design-pack
   repository records built state, not phase progress.

## Out of scope

- The `#later` stories: Foundry catalogue enrichment, backend API authentication (the internal
  user-context header stays), the Platform Admin page, environment choice beyond the configured
  list, individual AI access without a team, and CDP deployment of the integrated portal.
- Design F's four open questions: personal access, cross-cloud federation, agents, and Entra
  security groups as the membership source.
- The private-topology rebuild of Infradev, including Azure Managed Redis as APIM's external and
  semantic cache, and the end dates for exceptions X1–X3 — that is the gate before DEV, after
  B15, alongside B20 and B22 (Phase 7) passing. Every live consumer environment and SSV3/SSV5 is
  private and fully specified from its first resource (PR #20); only the Phase 1 Infradev and
  Sandbox proof may be public.
- The OpenTelemetry Collector service, and portal team-facing observability views — both TBC,
  added once their trigger or agreement lands (design G `#collector`, `#open`).
- Migrating the stored `admin` and `user` role values.
- The questions left open by the 14 October entries, each to be answered before the phase that
  needs it: how a region passes 32 model deployments per Foundry account; whether Defra's Entra
  team can raise the 250 created-object limit; whether a CDP federation in a team file holds only
  the service name; whether an Entra application management policy backs the client-secret rules;
  and the CCoE type codes still to be confirmed.
- Rewriting dated `decision-history.md` or `design-pack-plan.md` entries.

## Dated notes

**14 Oct 2026 — revised against ten open pull requests, then reviewed branch by branch.** Phase 3
(WS1–WS4) and the WS5 half of Phase 4 are written as code but nothing is merged, released or
applied, so every story's built state is unchanged. The review found no TODOs, no skipped tests
and no unimplemented workflow steps in the prepared repositories; the three deliberate gaps are
the unimplemented private topology, the soft-failing checkov job and the unbuilt shared-Research
grant. Phases 3 and 4 were rewritten to describe what the prepared code does; Phase 2 row 1 (the
team `slug`) became the blocker for Phase 4's WS6 builder; Phase 5's B18 moved onto the critical
path because the team tier is now OAuth only; Phase 1 gained the checkov and CodeQL gates; Phase
7 noted that the `submit` contract already carries `trace_parent`. The hold-ups are consent and
GitHub configuration, not code \u2014 see the prerequisite table and "Order of work from here".
**14 Oct 2026 — team `slug` built** (Phase 2 row 1), on `feature/github-tenant-orchestrator` and
`feature/gitops-run-links`. Derived from the team name, numbered on a clash, unique index,
`2026-10-14-add-team-slug` backfill, and shown on the team page as "Team ID" with a line saying
it cannot change. Phase 4's WS6 builder now has the identifier it was waiting for.

**14 Oct 2026 — service code required and verifiable** (Phase 2 row 2), on both portal branches.
Three characters (`^[A-Z0-9]{3}$`), required when a team is created, changed by an admin through
`PATCH /v1/teams/{id}` and a form on the team page, and checked through a `ServiceCodeVerifier`
port whose only adapter is the mock — so `verified` stays false and the team page keeps saying
"To be verified" until CDP or CCoE publishes a source. **Knowingly incomplete**: cross-phase rule
4 wants production to refuse a mock adapter, and that guard belongs with the real verifier rather
than now, when it would stop production starting at all. The journey is complete: a team can be
created, given a code, and provisioned end to end against the mock orchestrator.

`feature/github-tenant-orchestrator`. `team-desired-state.js` builds the whole team file from
what `main` holds now, read through a new `getCurrentDocument` on the orchestrator port, so an
engineer's edit, a D14 revert and the team's federations and agreed limits all survive a later
request. `501 desired-state-unavailable` now means only that the team has no slug. The gap it
leaves behind is Phase 2 row 2: a team with no three-character service code is refused with
`409 service-code-required` and has no screen to set one.

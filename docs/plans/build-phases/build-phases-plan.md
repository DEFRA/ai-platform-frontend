# Build stories B01–B22: phased delivery

> Cross-cutting plan, not a journey route. See also the
> ["three routes to a credential"](../../ui-flow-three-routes.md) journey
> ([Route 0](../route0-welcome-plan.md), [Route 1](../route1-plan.md), [Route 2](../route2-plan.md),
> [Route 3](../route3-plan.md)) and the other cross-cutting plans,
> [centralised-gateway-plan.md](../centralised-gateway/centralised-gateway-plan.md) and
> [research-tier-integration-plan.md](../integration/research-tier-integration-plan.md).
>
> **STATUS: NOT STARTED (13 Oct 2026).** Phase 0 is next. Update the `Status` line on each phase
> as it lands and add a dated note at the bottom recording what actually happened versus what is
> written here.

## Authoritative source

`ai-platform-discovery-docs` at `main` = `2c0db5c`, the **PR #19 merge commit**
(`feature/observability`, merged 13 Oct 2026), itself on top of the PR #18 merge commit `76a4e1a`
(`docs/iac-baseline-direction`, also merged 13 Oct 2026). Verified by `git log`: HEAD is that
commit, working tree clean, nothing merged after it. Every line number below is the post-#19
state unless marked post-#18.

PR #18 changed 62 files (+3531/−1465); note `42daba9` removed the HLD and AR pages and `243b60c`
restored them rebuilt, so `hld-designs.md` and `cloud-designs.md`/`.json` were new content then.
PR #19 changed 30 files (+1281/−199): design G written in full, diagram G1, the AR06 reference
view and build stories B20–B22 added; designs A, C and D, the HLD views, controls, F17, D08, the
decision history, the design-pack plan, the IaC baseline plan and the README aligned to it.

| Reference                                                                                             | What it mandates                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [design-teams.md](../../../../ai-platform-discovery-docs/src/content/design-teams.md)                 | Design F, PR #18. AI Platform teams separate from CDP teams; Admin and Member; creator is first Admin; a team always keeps an Admin; several teams per person; three-character service code                                                                                                                                |
| [design-observability.md](../../../../ai-platform-discovery-docs/src/content/design-observability.md) | Design G, new in PR #19. OpenTelemetry and a W3C trace beside CDP's `x-cdp-request-id` on every hop; Log Analytics backs every signal per environment; no collector in the first build; Azure Managed Grafana in SSV3/SSV5 with dashboards and alerts as code; `audit.capturePrompts` off by default, on only after a DPIA |
| [docs/iac-baseline-plan.md](../../../../ai-platform-discovery-docs/docs/iac-baseline-plan.md)         | D1–D16, workstreams WS0–WS7, milestones M1–M7, robustness controls R1–R12, the team-file schema and the `submit` contract (PR #18). PR #19 adds Application Insights and diagnostic settings to the `log-analytics` module and defers the rest of observability to B20–B22, required at the gate before DEV                |
| [docs/decision-history.md](../../../../ai-platform-discovery-docs/docs/decision-history.md)           | Three entries: the two 12 October entries (IaC baseline direction, teams and gateway tier) and the 13 October 2026 observability direction                                                                                                                                                                                 |
| [design-identity.md](../../../../ai-platform-discovery-docs/src/content/design-identity.md)           | Credential rules and lifetimes, CDP Web Identity trust, caller identities                                                                                                                                                                                                                                                  |
| [design-environments.md](../../../../ai-platform-discovery-docs/src/content/design-environments.md)   | Environment names and the Phase 1 progression through `SND1` then `SND4`                                                                                                                                                                                                                                                   |
| [build-stories.md](../../../../ai-platform-discovery-docs/src/content/build-stories.md)               | Now twenty-two stories (B01–B22) — B20–B22 (observability) added in PR #19 — with flows and acceptance criteria                                                                                                                                                                                                            |

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
4. Each `## B01 … ## B22` keeps `Present: skip` and gains one dated line:
   `Built state on 13 October 2026: built | partial | not started.` — sourced from the
   "Differs from the story" column being removed. Partial stories use `Status: proposal`, since
   the vocabulary has no `partial`. B20–B22 (PR #19) have no "Differs" entry yet — mark them
   `not started` until Phase 7 lands.
5. Update the `build-stories.md` frontmatter `description`, which promises a build-status section
   that will no longer exist.

### Repoint the inbound links

**17 live locations across 13 files**, verified by grep on the post-#18 tree:
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
  one Proposal row, a 19-row count, built-state `assertCopy` on B01/B09/B15, and
  `assert.doesNotMatch(/Build status on 9 October 2026|Differs from the story/)` page-wide.
  Read the whole block first — PR #18 added 796 lines to this file.
- `ms.date: "2026-10-13"` on every Markdown file touched.
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
3. Confirm the SonarCloud quality gate blocks rather than advises.
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

**Status: not started.** Stories B13, B14. Repositories: backend, frontend.
Depends on B08 (built). Parallel with Phases 1 and 3.

Mostly refactor. Design F contradicts parts of what is built, and more is already built than the
9 October table says — `last-admin`, member removal and multi-team membership all exist.

|     | Design requires                                                               | Built today                                                                              | Action                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Immutable unique team `slug`, `^[a-z][a-z0-9-]{1,22}[a-z0-9]$` (iac plan WS6) | No slug — `_id` and `normalisedName` only (`team-service.js:36`, index `mongodb.js:113`) | Add field, unique index and a backfill per `schema-changes.instructions.md`                                                                              |
| 2   | `serviceCode` three characters, required, verified (design F, R01)            | Optional, `max 20` (`routes/teams.js:37`); `verified:false` never set                    | Narrow the format, require before provisioning, implement `verified` behind a `ServiceCodeVerifier` port with a mock — the CDP/CCoE source is not agreed |
| 3   | Interface says Admin and Member; stored values stay `admin`/`user`            | Stored correctly; check frontend copy for "User"                                         | Copy change only — do not migrate stored values                                                                                                          |
| 4   | Last Admin can never be demoted **or** removed                                | Removal guard exists — `last-admin` 409 at `team-service.js:349-360`                     | Add `PATCH /v1/teams/{id}/members/{memberId}`; extend the existing guard to demotion                                                                     |
| 5   | A person acts in one team at a time                                           | Multi-team membership built; session holds only `pendingTeam`/`pendingAccess`            | Add `currentTeamId` to the `@hapi/yar` session and a switcher                                                                                            |
| 6   | SND1 is `infradev`; configurable `AIP_ENVIRONMENTS` (iac plan D1)             | `const TEAM_FACING_ENVIRONMENT = 'sandbox'` at `team-deployment-service.js:14`           | Replace with a config-driven list; the frontend option comes from the backend                                                                            |

Keep `sandbox` in the list rather than migrating existing `teamDeployments` — design A runs
Phase 1 in `SND1` **then** `SND4`, so both stay live.

Role changes go under a `server.locker` lock on the team and are audited. Settle before coding:
may an Admin leave a team they are the last Admin of by promoting someone in the same step?

**Verify:** unit, integration and one journey per user-facing change; a demotion `last-admin` 409
regression test; a backfill test proving a slugless legacy team is handled; update
[implemented-features.md](../../implemented-features.md).

---

## Phase 3 — IaC baseline, GitOps path in Infradev

**Status: not started.** Story B15. Repositories: `ai-platform-infra` and
`ai-platform-workflows` (public), `ai-platform-environments` (internal, **to be created**),
`ai-platform-tenants` and `ai-platform-deployments` (internal). No dependencies.

**Start this first.** It is the longest phase and Phases 4 to 6 queue behind it. Follow
[docs/iac-baseline-plan.md](../../../../ai-platform-discovery-docs/docs/iac-baseline-plan.md) —
do not re-derive it.

- **WS0** prerequisites: policy allows the names, public network access, Developer APIM and UK
  South; quota for the team model SKU; `azurerm` or `azapi` for Foundry projects; OIDC token
  refresh during the long APIM create.
- **WS1** infra `v0.3.0` — scaffold, release-please, the `team`/`pin`/`registry`/`environment`
  schemas, the checks CLI; `ai-platform-environments` with `registry.json`,
  `environments/infradev/platform.tfvars.json` and CODEOWNERS. D13: public code, private config.
- **WS2** `v0.4.0` — state storage, deploy-identity federated credentials, platform modules
  (`naming`, `log-analytics` (with Application Insights, local authentication off, and diagnostic
  settings for APIM, Foundry and both vaults; LLM message logging off — the rest of observability,
  Grafana and alerts, is Phase 7), `key-vault`, `apim`, `foundry-account`, `entra-api-audience`)
  and team modules (`foundry-project`, `foundry-deployment`, `apim-team-api`, `entra-team-app`).
  Root modules are `platform/` and `tenants/` (D12 renames design B's `team/`).
- **WS3** workflows `v1.0.0` and a moving `v1` — `submit-desired-state`, `validate-*`,
  `apply-platform`, `apply-tenants`, `infra-checks`, `release`, `workflow-checks`,
  `prune-op-branches`. D11: exact-pinned Terraform with committed lock files, checks in Node 24
  ESM, third-party actions pinned by SHA, `X-GitHub-Api-Version` pinned.
- **WS4** state repositories — thin callers, rulesets (PR required, 0 approvals, required
  `validate/{env}`, App bypass, App limited to `environments/infradev/**`), two Environments.
- **D2 public minimal platform** in SND1: `rg-aip-infradev-platform`, `apim-aip-infradev`
  (**Developer tier** for the proof, SKU from `platform.tfvars.json` — data, not code),
  `aif-aip-infradev`, `kv-aip-infradev-platform`, `kv-aip-infradev-tenants`, `law-aip-infradev`,
  `appi-aip-infradev`. No VNet, Redis, private endpoints or policy assignments. D15: Premium v2
  with virtual network injection is the target for live consumer environments, not this proof.
- **D5 identities**: GitHub App `ai-platform-orchestrator` (GitHub only),
  `id-aip-deploy-infradev` (federated only, no secret), `id-aip-backend-infradev` federated from
  the CDP `dev` backend role. The sandbox pair federates from the CDP `test` role.
  **Closes deployment gap 3.**
- **Closes deployment gap 2** — the hand-configured `research` API and its end-date policy move
  into the `platform` module.

**Verify:** M2 an infra merge reaches SND1 through release-please and pin with no manual step;
M3 a synthetic team's key calls its granted model and a non-granted model returns 403; M4 an
OAuth team's registration and federated credential arrive through GitOps and a foreign token is
refused; M5 proves robustness controls R1–R4 and R6.

---

## Phase 4 — Team provisioning through GitOps

**Status: not started.** Story B16; closes B09 and deployment gap 4. Repositories: backend,
frontend. Depends on Phases 2 and 3. Blocks Phases 5 and 6. Follows iac plan WS5 and WS6,
M6 and M7, D3, D6 and D14.

The async lifecycle already exists end-to-end against the mock — `requested → pr-raised →
merged → deploying → deployed → verified → active` plus terminal `checks-failed` and
`deploy-failed`, with `operationId` polling and `gateway.allowedDeployments` updated on
activation (`team-deployment-service.js:28-34, 191-230, 509-511`). **This phase is a port
reshape and a real adapter, not a lifecycle build.**

1. Extract a shared GitHub App client from `github-catalogue-source.js`; reuse the existing
   `github.appId/clientId/installationId/privateKey` config.
2. Reshape the port. Today it is per-deployment: `requestDeployment` and `getDeploymentStatus`
   (`adapters/tenant-orchestrator.js:1-11`). It must become `submitDesiredState`, dispatching
   `submit.yml` with the **whole** document, refusing documents over 60 KB, and storing run,
   branch, PR, merge SHA and apply run. Add a separate `TenantResourceVerifier` port with an ARM
   adapter and a mock, and a `tenant-orchestrator-registry.js` with
   `TENANT_ORCHESTRATOR=mock|github`; production refuses `mock`. Run the existing shared contract
   suite against both so the mock stays substitutable.
3. New config: `GITOPS_TENANTS_REPO`, `GITOPS_DEPLOYMENTS_REPO`, `GITOPS_POLL_MIN_INTERVAL_MS`,
   `AIP_ENVIRONMENTS`, `TENANT_ORCHESTRATOR`.
4. Status poller honours R11 — conditional requests, a minimum interval, backoff, non-terminal
   only. Sweep from the maintenance scheduler; audit every transition. Map onto the existing
   lifecycle states rather than inventing new ones.
5. D14 failure policy: re-dispatch once on `deploy-failed`; if it fails again and the run report
   attributes it to a team, submit a revert as a system operation; alert on unattributed
   failures; `abandon` on `checks-failed`. Retries and reconciles are **fresh dispatches on
   `main`, never re-runs**. One team's failure must not block other teams.
6. WS6 desired-state builder producing schema-valid documents, tested against the pinned
   release's `examples/` as fixtures.
7. Scope team credentials to `/apis/{slug}` on the environment's APIM — **closes gap 4**,
   removing the `MOCK_TIERS=team` workaround.
8. The frontend shows request status honestly with run links. Keep the mock for local runs and
   journey tests.

**Verify:** M6 a local backend with `TENANT_ORCHESTRATOR=github` reaches `active`, failures show
links, retry, reconcile and revert all work; M7 a team created in the portal gets a working
dedicated model credential in Infradev; the production mock-refusal guard has a test.

---

## Phase 5 — Limits and secretless production credentials

**Status: not started.** Stories B17 and B18. Repositories: backend, frontend. Depends on
Phase 4. The two stories are independent of each other — run them in parallel.

### B17 quotas, rate limits and increase requests

No quota, rate-limit or `llm-token-limit` code exists in either repository today.

1. `llm-token-limit` values in the team file within the catalogue's `capacityPolicy`; the gateway
   enforces them per team through the team's API policy.
2. A team limits page. An Admin requests an increase: within platform bounds it applies
   automatically through GitOps, beyond them the platform team reviews and the current limit
   stays in force meanwhile.
3. A caller over its limit receives 429 with a retry hint.
4. Agree the per-environment bounds and how the review is recorded before coding.

### B18 federated credentials for team applications

1. Prove the CDP Web Identity exchange end to end first. Issuer, subject and audience must match
   the federated credential **exactly** — no wildcard or flexible matching.
2. One app registration per team per environment, `app-aip-{env}-{team}`, shared by all that
   team's applications, up to **20** federated credentials. An Azure-hosted application uses its
   user-assigned managed identity as one of them; the managed identity never holds the team's
   access itself.
3. `oauth.federations[]` in the team file. A Member enters only the CDP service name, at creation
   or later; any Member may add one, only an Admin changes or removes one; applied through GitOps
   and pending until verified.
4. Replace the fake mock oauth secret at `mock-credential-issuer.js:38-39` and the unused
   `oauthClient:{enabled,appRoles:[]}` placeholder — **closes deployment gap 5**.
5. Enforce the credential rules: federation required in PREPROD and PROD where the host can
   federate; a client secret at most three months and three at once in DEV and QA, at most a year
   in PREPROD and PROD and only where federation is impossible; subscription keys for research,
   development and testing only, Research keys at most a week (built as the 7-day TTL).
   **Never fall back to a key after an OAuth denial.**
6. Suspension disables the registration in Entra and blocks it at the gateway; renewal re-enables
   both.

**Verify:** a federated token calls the team's API and a token from another issuer or account is
refused; a suspended registration is refused within the token lifetime; a team over its limit is
throttled and other teams are not; PREPROD and PROD refuse a key where federation is possible.

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
   identity.
3. APIM's diagnostic settings (the Phase 3 `log-analytics` module) use the W3C correlation
   protocol; the gateway and LLM logs carry team, application, model and deployment.
4. **New persisted field:** `audit.capturePrompts` (boolean, default `false`) on the team
   document — follow
   [schema-changes.instructions.md](../../../../ai-platform-backend-api/.github/instructions/schema-changes.instructions.md):
   a dated backfill so an existing team gets the default rather than `undefined`. Pull request
   checks refuse `true` without a DPIA reference.
5. Local runs export to `appi-aip-infradev`. Confirm Entra authentication for the Azure Monitor
   exporter from CDP and GitHub first; until the CDP export route is agreed, verify only the
   portal's own spans in local runs.

### B21 dashboards and search

1. `ai-platform-infra` Terraform creates `amg-aip-nonprod` (SSV3), its managed identity reading
   Infradev's Log Analytics workspace and Application Insights only; `amg-aip-prod` (SSV5)
   follows later, scoped the same way to production.
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

## Cross-phase rules

1. One branch per story, `feature/<brief-description>`; conventional commits; reviewed PR.
   `main` stays shippable.
2. Every behaviour change ships with tests. Every bug fix ships with a regression test that fails
   without the fix.
3. Before each PR run `npm run format`, then `format:check`, `lint` and `test` must pass.
   Never `--no-verify`.
4. Every external system sits behind a port with a configuration-selected mock; production
   refuses to start with a mock selected.
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
  semantic cache — that is the gate before DEV, after B15, alongside B20 and B22 (Phase 7)
  passing.
- The OpenTelemetry Collector service, and portal team-facing observability views — both TBC,
  added once their trigger or agreement lands (design G `#collector`, `#open`).
- Migrating the stored `admin` and `user` role values.
- Rewriting dated `decision-history.md` or `design-pack-plan.md` entries.

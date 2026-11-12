# Remaining work

Everything not yet built, in one place. What is built is in [implemented/](implemented/). Story identifiers (B01 to B30)
are those of `ai-platform-discovery-docs` `build-stories.md`, the authority for acceptance criteria; the design pack
(`design-*.md`) is the authority for direction. State on 22 Oct 2026; B28 rows on 30 Oct 2026; B29 row on 9 Nov 2026; B30 row and B18 wording on 12 Nov 2026. The table mirrors `build-stories.md#status`: every story not fully built there, and each unbuilt part of a built story, has a row here stating the same.

## At a glance

| Section | Category                 | Item                                                                                                                                                                                                                                                                                                                   | State                                                                 | Blocked by                                                           |
| ------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1       | Identity and credentials | B18: real team client secret and federations                                                                                                                                                                                                                                                                           | Not started (placeholder built)                                       | Entra admin consent                                                  |
| 1       | Identity and credentials | User schema unification: seeded and real users have different email fields (`mail` vs `email`); unified handling needed before production                                                                                                                                                                              | Not started (temporary workaround in place)                           | Schema decision                                                      |
| 1       | Identity and credentials | B15: Entra consent, `entra.enabled` back on in Infradev                                                                                                                                                                                                                                                                | Not started                                                           | Entra admin consent                                                  |
| 1       | Identity and credentials | Directory search: switch the add-member search from the seeded mock to Microsoft Graph (`DIRECTORY_MODE=graph`)                                                                                                                                                                                                        | Built against a mock; needs Graph consent                             | Graph consent                                                        |
| 2       | Limits and reporting     | B17: limits page and increase requests                                                                                                                                                                                                                                                                                 | Not started                                                           | None                                                                 |
| 2       | Limits and reporting     | B19: team usage and chargeback                                                                                                                                                                                                                                                                                         | Not started                                                           | Agreed tariff and period                                             |
| 3       | Observability            | B20 to B22: telemetry, dashboards, alerts                                                                                                                                                                                                                                                                              | Not started (infra groundwork only)                                   | None; gates creating DEV                                             |
| 4       | Research tier            | R8: journey tests and security pass                                                                                                                                                                                                                                                                                    | Not started                                                           | None                                                                 |
| 4       | Research tier            | B04: ARM liveness reconcile, live deployment status (integration plan Phase 4)                                                                                                                                                                                                                                         | Deferred by decision                                                  | A decision to start it                                               |
| 4       | Research tier            | Narrow the backend's Azure roles; lock the vault to CDP egress                                                                                                                                                                                                                                                         | Not started                                                           | CDP egress ranges                                                    |
| 5       | Quality and delivery     | Phase 0 (story status restructure); Phase 1 is B01 and B02 below                                                                                                                                                                                                                                                       | Not started                                                           | None                                                                 |
| 5       | Quality and delivery     | B01: SonarCloud scan, coverage thresholds, checkov soft-fail, Dependabot example, `azure` alias                                                                                                                                                                                                                        | Built; gaps remain                                                    | None                                                                 |
| 5       | Quality and delivery     | B02: a journey run against an environment, axe at WCAG 2.2 AA, no-JavaScript journeys                                                                                                                                                                                                                                  | Started                                                               | None                                                                 |
| 6       | Platform operations      | B24, B25: platform promotion with pinned settings, plans before merge (discovery-docs #27)                                                                                                                                                                                                                             | Planned: decided 20 Oct; none built                                   | None                                                                 |
| 6       | Platform operations      | B15: `infradev-reset` workflow (not built; `reconcile-all` built with B28); merged lifecycle rules, destroy cap and locks not yet checked as applied                                                                                                                                                                   | Built in Infradev; gaps remain                                        | None                                                                 |
| 6       | Platform operations      | B16: portal path to the two-step team removal (decommission)                                                                                                                                                                                                                                                           | Not started                                                           | Owners                                                               |
| 6       | Platform operations      | Dev proxy rule for GitHub artifacts                                                                                                                                                                                                                                                                                    | PR open (cdp-tenant-config #2024)                                     | CDP platform team review                                             |
| 6       | Platform operations      | B26: Terraform quality bar (T1 to T9, Q1 to Q8)                                                                                                                                                                                                                                                                        | Planned                                                               | None                                                                 |
| 6       | Platform operations      | B28: asynchronous GitOps operations; plan in discovery-docs `docs/async-operations-plan.md`; workflows #26 (warn on a partly configured events queue) open                                                                                                                                                             | Partly built 28 and 29 Oct; the rows below remain                     | None                                                                 |
| 6       | Platform operations      | B28: journey tests (multi-model, progress with and without script, `checks-failed`, `deploy-failed`)                                                                                                                                                                                                                   | PR open (journey tests #11)                                           | Review                                                               |
| 6       | Platform operations      | B28: end-to-end check in Infradev                                                                                                                                                                                                                                                                                      | Not started                                                           | B28 journey tests                                                    |
| 6       | Platform operations      | B29: private runner groups; plans and applies on GitHub-hosted larger runners in each environment's `snet-runners`, ending named exception X2 (discovery-docs #82)                                                                                                                                                     | Planned: decided 9 Nov; none built                                    | Enterprise allowing org-level private networking (design D verify 9) |
| 6       | Platform operations      | Automate the GitOps message-schema re-sync (worker and backend); options A to D, recommend A then B                                                                                                                                                                                                                    | Not started                                                           | None                                                                 |
| 6       | Platform operations      | Admin tasks, other environments, decommission path                                                                                                                                                                                                                                                                     | Not started                                                           | Owners                                                               |
| 8       | Record                   | Discovery-docs built-state refresh: infra and workflows rows (B15, B20 to B26) and the real Azure note                                                                                                                                                                                                                 | Partly done 22 Oct (#31)                                              | None                                                                 |
| -       | UI flow v3               | B13: Email a person added to a team (GOV.UK Notify adapter behind a port, key in the vault, one template); the add-member inset then adds "We will email them to say they have been added."                                                                                                                            | Deferred, not removed                                                 | A decision to start it                                               |
| -       | UI flow v3               | B09: Backend support reference for a failed set-up, in the support link, with an automatic alert to the platform team (B22 channel); replaces the frontend `AIP-` reference built from `operationId`                                                                                                                   | Deferred, not removed                                                 | B22 alert channel                                                    |
| -       | UI flow v3               | B30: journey tests for the section (choose a team, overview, environment page, deploy and progress, change limits) and the deploy to Infradev; the section's pages are built ([07](implemented/07-environments-and-deployments.md)) in an open pull request that needs the backend's reads and limits change in theirs | Frontend and backend in open pull requests; journey tests not started | Backend pull request merged; deploy needs G3 approval                |
| -       | UI flow v3               | Environment page extras ([mock-up](../flat-design-updates/environment/)): release pipeline across Development, Test, Pre-production and Production, promotion via `promotedFrom`, health and checks, Production approvals, capacity, audit, usage                                                                      | Not started                                                           | Design sign-off                                                      |
| -       | UI flow v3               | B09: Test environment: `qa` estate, `TEAM_ENVIRONMENTS` and `AIP_ENVIRONMENTS` in both repositories, registry entry, tenants and deployments folders; until then Test reads "not available yet" (Set up Test is built behind that config)                                                                              | Not started                                                           | `qa` subscription                                                    |
| -       | UI flow v3               | B18: Team secret expiry per environment (with B18: at most 3 months in DEV and QA, a year in PREPROD and PROD); each environment's page in the B30 section shows "Expires {date}" once the backend sets `expiresAt`                                                                                                    | Not started                                                           | Entra admin consent (B18)                                            |
| -       | UI flow v3               | B08: Backend reserves the team slug `new`, which clashes with `/teams/new` (a team named "New" has no page by slug until then); follow-up on backend PRs #50 to #52                                                                                                                                                    | Not started                                                           | Backend change                                                       |
| -       | UI flow v3               | B07: Renewal cap, the frontend's `RESEARCH_RENEWAL_CAP` (3) is hard-coded and must match the backend's `research.renewalCap`; read it from the backend instead                                                                                                                                                         | Not started                                                           | Backend exposing the cap                                             |
| -       | UI flow v3               | B06: "Get a new key" for an expired key at the renewal cap may be refused by the backend (`credential-expired-use-renew`)                                                                                                                                                                                              | Open                                                                  | Backend decision to allow a new key                                  |
| -       | UI flow v3               | B14: Real service-code verification; until then the team Details tab shows "Not checked yet" for every team                                                                                                                                                                                                            | Not started                                                           | An authoritative source agreed                                       |
| -       | UI flow v3               | B02: Journey tests and selectors in `ai-platform-journey-tests` for the new pages (build plan step 14): Models, team request, Teams Overview, the Environments section, Personal access, Members, Details, Set up Test, Home                                                                                           | Not started                                                           | None                                                                 |
| -       | UI flow v3               | B06: Infra, the tenants research file deploys only gpt-4o in infradev while the catalogue lists research SKUs on gpt-4-1-nano and gpt-5-nano, so those two show "Not available" to try on your own (owner infra/tenants)                                                                                               | Open                                                                  | A decision to deploy them                                            |

## 1. Identity and credentials

### B18 Real team client secret and federations

Prompt: [.github/prompts/10-b18-team-graph-credential.prompt.md](../../.github/prompts/10-b18-team-graph-credential.prompt.md).
**Blocked until Entra admin consent for `Application.ReadWrite.OwnedBy` is granted on the backend identity.**

- Terraform already creates `app-aip-{env}-{slug}`, its service principal and federated credentials, and deliberately
  ignores the `password` and `account_enabled`. Those, and the API's access-window named value, are the Portal API's.
- New adapter behind the existing `CredentialIssuer` port (not a new subsystem): `graph-client.js` beside `arm-client.js`
  (scope `https://graph.microsoft.com/.default`, the same federated credential, so rename `getArmCredential()`), and a
  Graph team issuer using the registration's `addPassword` and `removePassword`. It must pass
  `credential-issuer-contract.js` unchanged.
- Replace the `'No gateway issues team OAuth credentials yet'` branch in `credential-issuer-registry.js`; persist its
  `issuerKey`; stop needing `MOCK_TIERS=team`. Take the registration's object id from the run report carried onto the
  team record at verification (R6), never a Graph lookup by name.
- Vault and reveal are unchanged. Fail closed with a stable code where `entra.teamRegistrations` is false.
- **Remove the placeholder in the same change:** the `placeholder-credential-notice` component, `placeholder-credential.js`,
  the backend's `credentialPlaceholder` and `isMockedFor`, and the tests that pin them.
- Federations: one registration per team per environment, up to 20 federated credentials and 39 external clients;
  `oauth.federations[]`, `oauth.externalClients[]`, `oauth.secretsAllowed` written through the desired-state builder. A
  Member enters only the CDP service name; Terraform derives the issuer, subject and audience. Any Member may add one,
  only an Admin changes or removes one. Issuer, subject and audience must match exactly.
- Credential rules: federation required in PREPROD and PROD where the host can federate; a client secret at most three
  months and three at once in DEV and QA, at most a year in PREPROD and PROD only where federation is impossible; keys stay
  research, development and test only. **Never fall back to a key after an OAuth denial.**
- Suspension disables the registration in Entra and blocks it at the gateway; renewal re-enables both. Respect the Entra
  object limit (`entra.createdObjectLimit`, default 250) and confirm with Defra's Entra team before about 100 teams per
  environment.
- Verify: a federated token calls the team's API and another issuer's token is refused; a portal-issued secret works and a
  suspended registration is refused within the token lifetime; PREPROD and PROD refuse a key where federation is possible.

### Entra consent

- After consent for the deploy and backend identities, set `entra.enabled` back to `true` in `ai-platform-environments`
  (keep `teamRegistrations: false` only if just the team registration is still blocked) and remove the interim flag.

### Directory search: Graph switch-on

The add-member page searches a seeded mock directory (`DIRECTORY_MODE=mock`, the default). The Microsoft Graph adapter
is built and tested but refused at start-up, and production refuses `mock`, so production cannot start until this is
done. Design: [ai-platform-discovery-docs#38](https://github.com/DEFRA/ai-platform-discovery-docs/pull/38). To switch
on:

- B27 (deployed to CDP dev, user-confirmed 5 Nov 2026) supplies the signed-in Admin's token, which the adapter exchanges on behalf of the Admin.
- An Entra admin grants tenant-wide consent for the delegated Graph permission `User.ReadBasic.All` on the portal API
  app registration (`api-aip-portal`), and the CDP egress allow-list includes `graph.microsoft.com`.
- Allow `graph` in the backend's directory registry, then set `DIRECTORY_MODE=graph` and redeploy.

The backfill `2026-11-03-team-members-directory-only` runs when the backend first deploys with this change, not at
switch-on. Read its start-up log counts (teams without an Admin, `credentialsOrphaned`).

## 2. Limits and reporting

### B17 Quotas, rate limits and increase requests

- The gateway already enforces per-team request and token limits and the model allow-list, and the team file requires
  `gateway.limits.tokensPerMinute` and `requestsPerMinute`. The portal half is missing.
- A team limits page: an Admin requests an increase; within platform bounds it applies through GitOps, beyond them the
  platform team reviews and the current limit stays. A caller over its limit gets `429` with a retry hint.
- The desired-state builder already emits defaults (`TEAM_DEFAULT_TOKENS_PER_MINUTE`, `TEAM_DEFAULT_REQUESTS_PER_MINUTE`);
  per-environment bounds are agreed under B17.

### B19 Team usage and chargeback

- A usage query joining the gateway log to the team file by team, model, environment and service code; a team usage page
  (Members see it, only Admins export it).
- **Strict isolation:** a foreign team identifier is refused, not hidden. 100% coverage on the isolation checks, tested at
  the service and route layers.
- Until the tariff and period are agreed with the chargeback owners, show tokens and label cost an estimate.

## 3. Observability (B20 to B22)

B20 and B22 must both pass in Infradev **before DEV is created** (design G `#stages`).

- **B20 telemetry:** OpenTelemetry in the frontend and backend, a W3C `traceparent` beside CDP's `x-cdp-request-id` (do not
  replace it; OpenSearch keys off `trace.id`), and team, application, flow, API, model and environment as span
  dimensions. The portal passes `trace_parent` and `operation_id` to the `submit` dispatch; the workflows export their own
  spans. APIM diagnostics carry team, application, model and deployment. New persisted field `audit.capturePrompts`
  (default `false`) needs a dated backfill, and checks refuse `true` without a DPIA reference.
- **B21 dashboards:** Terraform creates `amg-aip-nonprod` (private endpoints), reading Infradev's Log Analytics and
  Application Insights only; dashboards are JSON in the infra repo; a playground folder allows experiments. Team-facing
  portal views are TBC (design G `#open`); do not build ahead.
- **B22 alerts and runbooks:** Grafana alert rules for gateway errors, latency, capacity, stuck GitOps operations, credential
  expiry, missing telemetry and missing audit capture, each linking a runbook; `ag-aip-{env}` action group; channels TBC.
- Verify: one trace follows a team's creation from the portal through `submit` and apply; a forced burst of gateway 5xx and a
  failed apply each raise an alert; stopping the gateway logs raises the missing-telemetry alert.
- Already in place: Application Insights, W3C APIM diagnostics, token metrics, and `trace_parent` plus a `Traceparent`
  trailer in the contract.

## 4. Research tier follow-ups

- **R8:** prompt [09-r8-tests-and-docs.prompt.md](../../.github/prompts/09-r8-tests-and-docs.prompt.md). A research-tier
  journey test against Infradev and a team-tier journey that asserts the placeholder wording (so it cannot outlive its
  reason); a security pass (no secret logged, `keyHint` everywhere but the two reveal points, subscription scoped to the
  research API, Joi rejecting unknown keys, the custom APIM role least privilege); and the discovery-docs record (section 8).
- **ARM liveness reconcile (deferred, not removed):** a Foundry deployments reader, `provisioningState` and
  `lastReconciledAt` on models so the UI can explain a greyed-out model, and a token-gated `POST /maintenance/sync-catalogue`.
  Do not start without being asked.
- **Narrow roles and network:** replace the backend app registration's Contributor and User Access Administrator on the
  subscription with the custom role and `Reader`, and lock the tenants vault to CDP egress ranges (needs the ranges from
  the CDP platform team). The identity roles for the backend, `id-aip-backend-{env}`, are in design E.
- **Retire the hand-built sandbox** (`SNDAIEEXPRGP1401`, `DEPLOYTESTDEFRA`, `kv-aip-sandbox-tenants`) once the last key
  issued there has expired, and drop the `sandbox` entry from `AIP_ENVIRONMENTS`.
- Add `swedencentral` to Infradev's `foundry.regions` if Defra policy allows, so models with a Sweden Central SKU can join `research.json`.
- The model step does not yet hide models an environment cannot deploy.
- A real `ServiceCodeVerifier` once an authoritative source is agreed.

## 5. Quality and delivery

- **Phase 0:** restructure `build-stories.md` in discovery-docs so the story map carries a Status column and a dated build
  note, and delete the stale `#status` section. `Implemented` must be added to the closed status vocabulary in seven places
  (`scripts/manifest.js`, `src/content/overview.md`, `test/site.test.js`, `test/browser/review.spec.js` and others).
- **B01:** coverage thresholds in both `vitest.config.js` (95% statements, lines and functions, 90% branches; never lower),
  confirm the SonarCloud gate blocks, triage the checkov findings and remove the soft-fail, and remove the deprecated
  `azure` alias for `provisioning.mode`.
- **B02:** axe scan at WCAG 2.2 AA on every page a journey visits, one no-JavaScript journey per user-facing story
  (B06 to B10), `journey-` test data removed by a maintenance call. No journey run against an environment is recorded.
- **B14:** service-code verification is a mock only.

## 6. Platform operations

- **Dev proxy:** `cdp-tenant-config` #2024 allows the dev backend to download GitHub Actions artifacts
  (`.blob.core.windows.net`). Until it deploys, a team deployment stays on "Setting up access in Azure" after its apply has
  succeeded. After it deploys, the stuck deployment resolves on the next poll (or a Platform Admin runs
  `POST /v1/admin/team-deployments/{id}/reconcile`).
- **Terraform quality** (`ai-platform-infra` `docs/terraform-quality-plan.md`, review in infra #24): descriptions on about 40
  variables and 35 outputs, tests for 7 untested modules and the failing-case tests for 6 more, tflint `recommended`
  enforcement, pinned provider versions in module tests, a tested platform-to-tenants output contract, and relaxing the
  tenants `platform_release` precondition so the two can deploy independently (items Q1 to Q8, story B26).
- **Asynchronous operations** (story B28, plan in discovery-docs `docs/async-operations-plan.md`, decisions in D09 revised 25 Oct 2026): a worker service applies GitOps changes off the request path, with a backend outbox and events. Partly built on 28 and 29 Oct 2026 (infra `v0.10.0` to `v0.10.3`, workflows `v2.0.0` to `v2.0.4`, worker `0.1.0`, backend `0.53.0`, frontend `0.60.0`, the `@v2` callers, CDP's grant to the events identity; see [05](implemented/05-platform-and-gitops-pipeline.md)). Left: the journey tests (journey tests #11), the end-to-end check in Infradev and workflows #26; CDP's events role, not `sqs:SendMessage` only, was accepted on 29 Oct 2026.
- **Automate the GitOps message-schema re-sync** (worker and backend; origin: B28 CDP messaging change, 27 Oct 2026; owner: Platform Engineer for the workflows, Developer for the two repos' scripts; plan in discovery-docs `docs/async-operations-plan.md`, schemas in `ai-platform-infra` #31). `ai-platform-worker` and `ai-platform-backend-api` vendor `src/contracts/aip-gitops/` byte for byte from `ai-platform-infra/schemas/messages/` at the ref in `src/contracts/aip-gitops/VERSION`. `npm run contracts:sync -- {ref}` downloads at that ref; `npm run contracts:check` compares only with the pinned ref. Two gaps follow:
  1. After infra #31 is squash-merged, the pinned feature-branch SHA may stop resolving (404 in CI; unlikely, as GitHub usually keeps PR commits). Both repos then need a manual `contracts:sync -- {merged SHA}`.
  2. More important: a later infra schema change fails no CI in either repo, so the copies drift silently. A new field sent by the workflows is then rejected as invalid (the backend logs and acknowledges it, so the status update is lost; the worker dead-letters it) with CI green.

  Options, recommended A then B:
  - **A. Pin `VERSION` to an infra release tag** (release-please) instead of a SHA: removes the 404 risk; the bump is still by hand.
  - **B. Scheduled workflow in the worker and backend** that runs `contracts:sync` against infra's latest release tag or `main` and opens a PR when files differ: also detects drift. Needs pull-request permission and SHA-pinned actions.
  - **C. Infra opens PRs in the consumers** on a schema change: needs a cross-repo token or GitHub App.
  - **D. Publish the schemas as an npm package** with Dependabot: needs a registry and publish pipeline; the largest change.

  Done when a schema change in infra produces a sync PR in the worker and backend without manual work, and drift is visible.

- **Promotion** (discovery-docs #27): two pins, pinned settings and pre-merge plans, so a release can reach an environment
  without lockstep.
- **Private runner groups** (story B29, design B `#runners` in discovery-docs #82, decided 9 Nov 2026): plans and applies run on GitHub-hosted larger runners in each environment's `snet-runners`, so named exception X2 ends. Enterprise and organisation owners do the GitHub settings by hand from a runbook; the bootstrap and the `platform` apply do the Azure side. Blocked on the enterprise allowing organisation-level private networking.
- **Admin tasks:** delete the `AIP_SETTINGS_AUDIT_TOKEN` secret and the `AIP_RELEASE_APP_ID`, `AIP_SUBMIT_APP_IDS` and
  `AIP_ENVIRONMENTS` variables from `ai-platform-workflows` once `settings-drift.yml` is removed (2 Nov 2026); the organisation Actions allow-list for the workflows the callers use; decide whether to turn off
  `autoPin` for Infradev; turn off `operator_state_access` once the pipeline is accepted.
- **Other environments:** CDP `infra-dev`, `test` and `prod` have no config for these services; the research tier is dev only
  so far.
- **Decommission:** the IaC checks handle `pending-removal`, `removed` and deletion with a cooling-off period, but a team has
  no portal path to it.

## 7. Housekeeping

- Rotate the old MongoDB password and GitHub PAT that sat in plaintext comments in a local backend `.env`.
- Open Dependabot pull requests: infra #9, workflows #2, frontend #36 to #42, backend #36 and #37, journey-tests #9 and #10.
- Finished one-shot prompts (R0 to R7, `01` to `08` in `.github/prompts/`) are kept for history; delete them when no longer wanted.

## 8. Record the built state in discovery-docs

`build-stories.md#status` was refreshed on 22 Oct 2026 (discovery-docs #31) for the portal stories, and again with this
table for B15 and B20 to B26. Still to read from the repositories: the infra and workflows rows (B15, B20 to B26; infra
v0.9.x), the real Azure note and gap 2 (is the research file applied?), the CDP dev rollout and the proxy finding. Use one
pull request that follows that repository's propagate, date and record rules, and report built state only from the
repositories, with the version and date.

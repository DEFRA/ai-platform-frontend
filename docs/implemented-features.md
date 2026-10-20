# Implemented features

A single, cross-repo list of what has actually been built so far in the AI Platform Portal (
`ai-platform-frontend` + `ai-platform-backend-api`), for new joiners to get oriented quickly. This
is a summary/index, not the source of truth — every item below links to the plan doc, README
section or design-pack page that has the full detail, and those are what you should read (and
update) when you touch the feature. Do not copy detail out of those documents into this file; keep
this page to short bullet points.

Last updated: 18 Oct 2026 (an admin removes a model from the team page through GitOps; team environments from `TEAM_ENVIRONMENTS`; and, from 15 Oct 2026, the IaC GitOps pipeline applied in Infradev, with a team applied end to end from the portal; the catalogue's team tier; team slug; the WS6 desired-state builder, so GitOps requests build a real team document; team credentials are OAuth client secrets; queued team changes; IaC baseline WS5: a GitHub `TenantOrchestrator` behind `TENANT_ORCHESTRATOR`; every GitOps change attributed to the signed-in person's `entra:{oid}`; the team request page links to its runs and pull request; see below).

## Journey status at a glance

The core product journey is "three routes to a credential" — see
[docs/ui-flow-three-routes.md](ui-flow-three-routes.md) for the full flow and
[docs/plans/](plans/) for the build plan behind each route.

| Route                                               | Covers                                                                                                 | Status                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [Route 0](plans/implemented/route0-welcome-plan.md) | Home page (`/`), the shared entry point into the other three                                           | **Implemented** (29 Sept 2026, flat design build spec)                                          |
| [Route 1](plans/implemented/route1-plan.md)         | Research tier: browse the model catalogue, request a personal shared-model credential, manage it       | **Implemented** (22 Sept 2026)                                                                  |
| [Route 2](plans/implemented/route2-plan.md)         | Team tier: create/select a team, request a dedicated model deployment for it                           | **Implemented** (23 Sept 2026, refactored 25 Sept 2026 to match the discovery-docs design pack) |
| [Route 3](plans/implemented/route3-plan.md)         | Team tier: joining a team that already has access, admin-vs-user role enforcement, credential rotation | **Implemented** (25 Sept 2026)                                                                  |

## Route 1 — Research tier shared model access

- Sign in with Defra Entra ID (OIDC), session-backed; the person is keyed on the immutable Entra
  `oid` and `tid`, so every GitOps change is attributed to `entra:{oid}`. Email is display only and
  **not unique**: two people records can share one, so never look a person up by email.
- Browse the model catalogue: `/models` (list) and `/models/{slug}` (detail) — backend `GET /v1/models`.
- Request a credential for a shared model: `/connect/shared/*` (model choice, purpose + terms step,
  one-time secret reveal) — backend `POST /v1/credentials` (`tier: 'research'`).
- `/manage` — view your own credentials, renew (within a renewal cap), revoke.
- Backend: `users`, `models`, `credentials` routes/services; subscription-key credentials with a
  configurable TTL and renewal cap; lazy expiry (a credential flips to `expired` the next time it's
  read past its `expiresAt`, not via a background sweep).

## Route 2 — Team tier, first person in a team

- Create or select a team: `/teams/new`, `/teams/{id}`.
- Each team has an immutable `slug`, derived from its name when the team is created and shown on
  the team page as "Team ID". It names the team's GitOps file, its gateway API path and its model
  deployments, so it never changes — including on a rename.
- Team membership: an admin invites by Defra email, changes a member's role with
  `PATCH /v1/teams/{id}/members/{memberId}`, or removes them. A team always keeps an admin, so the
  last one can be neither removed nor demoted — promote someone else first; both changes are
  serialised behind a team lock so two admins cannot demote each other into an admin-less team.
- A person belongs to several teams but acts in one at a time (design F): opening a team's page
  makes it the current team, held in the session as `currentTeamId` and marked on `/teams`.
- Each team also has a three-character service code, required when the team is created and
  changeable by an admin on the team page. It is checked through a `ServiceCodeVerifier` port whose
  only adapter is a mock, so teams show "To be verified" until an authoritative source is agreed.
- Request dedicated model deployments for the team: `/connect/team/*`. The model step takes
  **several models at once** (checkboxes; the model you came from on its page is ticked; one the team
  already has is shown but not selectable). The backend makes one deployment per model in the order
  asked (the first in flight, the rest queued), idempotent by a key made when the answers are given
  (a double click replays one request). The wait page follows every model, then one client secret
  covers them all (a model that failed, or could not be added, is named). A journey belongs to the
  person who chose the team and is dropped for anyone else; it is cleared when the request is made;
  sign-out ends the whole session; sessions are always held server-side (`maxCookieSize: 0`), so a
  cookie keeps nothing.
- Backend: `teams`, `teamMembers`, `teamDeployments` collections; a `TenantOrchestrator` port
  (`mock`, or `github` - see below) drives the slow "provision the team's stack" path; one **shared credential per team per
  environment** (not per model) once the deployment reaches `active`. Its `allowedDeployments[]` is
  the team's live gateway grants, read from the team's deployments on every response and never
  stored, so a removed model leaves the credential at once; a revoked credential keeps what it
  covered when it was revoked.
- Team credentials are OAuth client secrets (decision of 14 Oct 2026): `/connect/team/*` requests
  `credentialType: 'oauth'` and the team pages say "client secret", never "key". Research keeps keys.
  Until the real OAuth issuer (M7), live mode answers `501 gateway-not-enabled`, which the wait page explains.
- The environments a team can deploy to come from `TEAM_ENVIRONMENTS` (backend) and
  `TEAM_ENVIRONMENTS` (frontend, default `infradev`; the details step offers them as radios and
  refuses any other) rather than a constant in code, so Phase 1's Infradev-only proof and the later
  estate (see [design-environments.md#phase-1](../../ai-platform-discovery-docs/src/content/design-environments.md))
  need no code change.
- Remove a model (18 Oct 2026, in the open PR #35s): the team page lists the team's models with
  their status; an admin removes an `active` one from `/teams/{id}/models/{deploymentId}/remove`
  (confirm page, then `DELETE /v1/teams/{teamId}/deployments/{id}`). The backend runs it as a
  `remove` follow-up through GitOps (`removing` → `removed`, `$pull` from `allowedDeployments`; back
  to `active` with a reason on failure); the team page offers a refresh link while a model is
  changing (never an automatic reload under its forms) and says when the listing is unavailable.
  The wait page sends a removing or removed deployment to the team page. Team decommission is
  IaC-only so far.
- Environment labels come from the credential (`environment-names.js`): a team credential names its
  own environment, a Research key the Sandbox. Rotate is for team credentials only; a Research key
  is renewed, never rotated. The mock OIDC user carries stable `oid` and `tid` claims for the backend.

## Route 3 — Team tier, joining a team with existing access

- A second (and later) team member sees the team's existing shared credential on `/manage` with no
  extra request or wait (it was already issued when Route 2's deployment went active).
- Admin-vs-user role enforcement: only a team admin can rotate or revoke the shared team credential;
  a `user`-role member sees status only.
- Rotate (`POST /v1/credentials/{id}/rotate`, `/manage/credentials/{id}/rotate`) — distinct from
  renew: issues a new secret without changing the expiry/renewal count, for "I think this key
  leaked" rather than "this key is about to expire".
- Cross-team isolation: a user can never see or act on another team's credential (404, not 403, to
  avoid disclosing existence).

## Flat design update (29 Sept 2026)

- Defra brand chrome applied across every page: `.defra-header`/`.defra-primary-nav` (green,
  restyled `govukServiceNavigation`)/`.defra-footer`, `govukPhaseBanner` (Alpha), new
  `_govuk-frontend.scss` theme (Helvetica/Arial, Defra brand colours, 1024px page width). See
  `docs/flat-design-updates/build-spec.md` and `_govuk-frontend.scss` for the source spec.
- Nav restructured to Models / Your access (signed in) / Help, dropping Home and Connect to a
  model as nav items (`src/config/nunjucks/context/build-navigation.js`).
- Presenter layer: `src/config/nunjucks/filters/format-label.js` (enum -> display label) and a
  simplified `formatDate` (`d MMMM yyyy`).
- `/manage` restructured from per-team tabs to one merged "Keys and client secrets you can use" table
  (personal + team credentials together), a "Your models" table (every model a person's teams have
  or are changing, with team, environment, status, failure reason and the one action that fits:
  check progress, see what happened, finish setting up, or manage in the team) and a plain-text
  "Your teams" list; row shaping lives in `manage/access-view.js`.
- Home page (`/`) now has real content for both signed-out and signed-in visitors (was a
  placeholder) — see the Route 0 status above. Signed in, one inset per team with an active client
  secret names the team and the models it covers today (or says none are deployed) and links to
  `/manage`.

## Cross-cutting platform features

These aren't tied to one route — they're shared infrastructure every route above depends on.

- **Credential lifecycle**: issue / renew / rotate / revoke, lazy expiry on read, plus two
  background-style maintenance operations (`expireCredentials`, `reconcilePendingCredentials`)
  exposed via a token-gated `/maintenance/expire-credentials` endpoint (see backend README's
  "Development helpers") and run automatically by an in-process scheduler plugin
  (`src/plugins/credential-expiry-scheduler.js`, `MAINTENANCE_SCHEDULER_ENABLED`/
  `MAINTENANCE_SCHEDULER_INTERVAL_MS`, default every 5 minutes, disabled under `NODE_ENV=test`).
  A gateway-level defence-in-depth expiry check is live on the research API's APIM policy
  (`DEPLOYTESTDEFRA`): it blocks on `context.Subscription.EndDate` vs `DateTime.UtcNow`,
  independent of the scheduler's suspend() call — applied directly via ARM, not tracked as a repo
  file. `apim-credential-issuer.js`'s `issue()`/`renew()` set APIM's `expirationDate` (the same
  value as `EndDate`) from the exact `expiresAt` Mongo stores, so the two never drift — `renew()`
  is now always called on renewal, not only when the credential had already expired. Requesting a
  new research credential for a model that already has an `expired` one is rejected
  (`409 credential-expired-use-renew`, shown with a "Manage your credentials" link) rather than
  silently reactivating the same deterministic APIM subscription under a brand-new credential
  document and Key Vault secret.
- **Idempotency**: every credential/team/team-deployment creating endpoint requires an
  `Idempotency-Key` header; replays return the original result rather than creating a duplicate.
- **Audit events**: every state-changing action records a `recordAuditEvent` entry (actor, action,
  resource, outcome) in a TTL-expiring `auditEvents` collection — never a secret.
- **`CredentialIssuer` port, now provider-extensible**: issue/renew/rotate/revoke/suspend behind a
  `credential-issuer-registry` resolved per model's `gateway` (new credentials) or per already-issued
  credential (via its persisted `issuerKey`) — a `mock` issuer and a real Azure APIM issuer talking
  to the ARM management plane (`src/adapters/azure/`, `ai-platform-backend-api`). `PROVISIONING_MODE`
  is `mock | live` (production refuses to start on `mock`; `azure` is a deprecated alias for `live`),
  and in `live` mode `ENABLED_GATEWAYS` (default `azure-apim`, renamed from `ENABLED_ADAPTERS`)
  lists the gateways the environment can run - a model on any other gateway gets
  `501 gateway-not-enabled`. See
  [research-tier-integration-plan.md](plans/implemented/integration/research-tier-integration-plan.md)'s Phase 1
  and the [centralised gateway plan](plans/implemented/centralised-gateway/centralised-gateway-plan.md).
- **GitOps `TenantOrchestrator` (WS5 and WS6, 14 Oct 2026, merged)**: `TENANT_ORCHESTRATOR=github`
  dispatches `submit.yml` with the whole team document and tracks it to `active` (pull request,
  merge, GitHub Deployment, run report, ARM check), with the D14 retry-then-revert policy, a
  scheduler sweep and Platform Admin retry/reconcile; one change per team file at a time, so a later
  request waits as `queued` ("Waiting for another change to this team to finish"). The document is
  built from the file `main` holds now, so an engineer's edit, a revert, and the team's federations
  and agreed limits all survive a later request; the `/connect/team/request` page shows its links
  under "Details for the AI Platform team". A team needs a three-character service code before its
  first request (`409 service-code-required`). See the backend README's "GitOps tenant orchestrator"
  section and the [IaC baseline plan](../../ai-platform-discovery-docs/docs/iac-baseline-plan.md).
- **IaC GitOps pipeline, applied in Infradev (15 Oct 2026)**: the platform and teams are created by
  GitHub Actions, not by hand. `ai-platform-infra` (`v0.7.0`) holds the modules, schemas and
  `aip-checks`; `ai-platform-workflows` (`v1.1.0`) the reusable workflows; `ai-platform-environments`
  the registry; `ai-platform-deployments` the platform pin, whose merge applies the platform; and
  `ai-platform-tenants` one file per team, whose merge applies the team. A request made in the
  portal reached a real team (Foundry project, `gpt-4o` deployment, APIM API) with no manual step
  except merging the pull request. Entra is off for `infradev` (the deploy identity cannot create
  app registrations yet), and `entra.teamRegistrations` skips only the team's registration. The
  catalogue has a team tier: `gpt-4o` through a UK South `Standard` SKU, `gpt-4-1-nano` and
  `gpt-5-nano` through Sweden Central, which Defra policy blocks for now. What is done and what is
  left: [iac-rollout-state.md](plans/in-progress/iac-rollout-state.md).
- **Research tier IaC (R1, 20 Oct 2026, released as `ai-platform-infra` v0.9.0, not applied)**:
  the research tier is a platform-owned team file, `research.json`, naming `subscription-key`, built
  by the same tenants module as a team: shared project, account-child deployments named as callers
  send them, and a `research` API that requires a subscription and runs `aip-key-guard`, with the
  limits counted per subscription. `aip-checks` accepts a key only in that file, never from a writer
  App, and reconciles its deployment names with the catalogue. The platform root adds the custom
  API Management role the Portal API needs to mint subscriptions. Terraform creates no
  subscription. Nothing exists in Azure until R2 applies. See
  [research-tier-infradev-plan.md](plans/in-progress/research-tier-infradev-plan.md).
- **Team deployment verification finishes and says why it did not (R6, 19 Oct 2026, merged)**:
  the verifier's reason is kept, counted on `gitops.verification`, audited
  (`teamDeployment.verificationFailed`) and logged on every failed attempt. After
  `GITOPS_VERIFY_MAX_ATTEMPTS` (default 5) the deployment fails with the reason, so a missing
  `AIP_ENVIRONMENTS` entry shows as `environment-not-configured` instead of an endless "Setting
  up"; a Platform Admin retry starts the count again. An active model lists its Foundry project,
  deployment and API by name and kind on the team page, with an "Entra app registration" line
  (created, or skipped awaiting consent) taken from the run report. The registration's client,
  object and service principal IDs are carried onto `oauthClient.registration` when it verifies,
  for Phase 5's B18 issuer.
- **Honest status labels (R7, 19 Oct 2026, merged)**: a deployment's GitOps status is
  mapped explicitly in `deployment-status.js`, so "Setting up" means only the six in-progress
  states and an unmapped status reads "Status unknown" rather than progress. `active` reads "Ready
  to use", a credential's `pending` reads "Being created", the wait page says "Setting up your
  model access" until the client secret step, and the backend's last progress step is "Preparing
  your client secret" (all four steps done once `active`).
- **Team client secret placeholder (R5, 19 Oct 2026, merged)**: while `MOCK_TIERS=team`
  mocks the Graph step, every page showing a mocked team secret (wait page, credential, `/manage`
  row and detail, rotated, revealed) carries one shared inset saying it does not work with the
  gateway yet and why. Research keys are unaffected and still reach the real Key Vault. Removed by
  Phase 5's B18. The mock vault is in memory, so a restart loses the secret.
- **MongoDB write locks** (`mongo-locks`, `server.locker`/`request.locker`) guard every non-atomic
  multi-step write (team creation, credential issuance, deployment status transitions).
- **Federated backend-to-Azure auth**: `armAuth.authMethod` (`AZURE_ARM_AUTH_METHOD`) picks how
  `ai-platform-backend-api` authenticates as the ARM app registration shared by the credential
  issuer and Key Vault adapter - `client-secret` (local dev only, no AWS STS to federate from) or
  `federated` (every deployed CDP environment: a `ClientAssertionCredential` backed by
  `@defra/hapi-auth-oidc`'s `WebIdentityTokenProvider`, no client secret involved). See backend
  README's "Testing against live Azure resources" section and `src/adapters/azure/azure-credential.js`.
- _*Schema backfills*; `v0.7.0` adds the team tier (see the IaC pipeline above)_: a self-applying, one-off data migration mechanism
  (`src/common/backfills/`) added 25 Sept 2026 — see backend README's "Schema backfills" section.
- **Model catalogue synced from a `CatalogueSource` port**: a `file` adapter (default - reads
  `src/common/seed/{models,providers}.seed.json`, so tests/compose need no network) and a `github`
  adapter (Octokit, reads `ai-platform-infra`'s `catalogue/` at a pinned release tag, with ETag
  caching and a last-good-mirror fallback on any failure), selected by `CATALOGUE_SOURCE`. Synced
  into MongoDB on every backend start (`syncCatalogue`, `ai-platform-backend-api`) with
  `catalogueSha`/`release`/`syncedAt`; models no longer present in the source are retired
  (`eligible: false`, `lifecycle.status: 'retired'`), never deleted. `ai-platform-infra`'s
  `catalogue/` holds 8 Foundry-deployment models + 1 provider: `v0.1.2` is the flat
  `cloud`/`adapter` shape and `v0.2.0` (tagged, merged) adds `hosting`/`gateway` offerings and
  `catalogue/schema/`. The backend reads only the new shape and stores models with a nested `hosting`
  object and `gateway`; see the [centralised gateway plan](plans/implemented/centralised-gateway/centralised-gateway-plan.md).
  A model contradicting or referencing an unknown offering is skipped, not synced.
  Per-model `apiProfile` (`chat-completions` vs `responses`) drives both the frontend's gateway URL
  shape (`gateway-request.js`) and the backend's `apiVersion` default: a `responses`-profile model
  is always pinned to `2025-03-01-preview` regardless of what the catalogue source supplies for
  that field (verified against the real sandbox gateway — `responses` 404s on the older
  chat-completions-era default even when the source says otherwise), since `chat-completions` isn't
  supported at all for a responses-only model. `models.seed.json` (the local `file` source) now
  includes one `responses`-profile model (`gpt-5-3-codex`) so this path is exercised without GitHub
  catalogue access. See [research-tier-integration-plan.md](plans/implemented/integration/research-tier-integration-plan.md)'s Phase 2.
- **Credential secrets persisted to Key Vault, with an audited reveal**: a `CredentialVault` port
  (`issue`/`rotate` write through it, `renew` updates the existing secret version's expiry in place
  via `updateExpiry` rather than rotating it, `revoke` soft-deletes) behind a `mock` adapter
  (default, in-memory) and a real Azure Key Vault adapter (`@azure/keyvault-secrets`,
  `ai-platform-backend-api`), routed by the credential's `issuerKey`, the same as the credential
  issuer. A vault write/expiry-update failure never fails the request (the user already has the
  secret) — it flags the credential `vaultState: 'unwritten'` instead, retried by the existing
  `reconcilePendingCredentials` maintenance job (which re-writes the secret using the already-
  updated Mongo `expiresAt`). `POST /v1/credentials/{id}/reveal` lets an owner (research tier) or
  team admin (team tier) re-view an already-issued secret, audited with a required reason,
  `Cache-Control: no-store`. See
  [research-tier-integration-plan.md](plans/implemented/integration/research-tier-integration-plan.md)'s Phase 3.
- **Loading state on backend-triggering buttons**: `.app-button--loading-on-submit` (view) +
  `application.js` progressive enhancement disables the submit button and shows a spinner on
  `submit`, so a slow request (renew, revoke confirm, issue a credential) can't be re-triggered by
  repeat clicks. Applied to Renew (`/manage` list and credential detail), the revoke confirm page's
  Continue button, and the shared-model "Confirm and get my key" button.
- **Live-verified against real Azure sandbox resources** (not just mocked/nocked): issue, gateway
  completion, reveal and revoke all confirmed end-to-end against the real `DEPLOYTESTDEFRA` APIM and
  `kv-aip-sandbox-tenants` Key Vault. See the plan doc's dated note for the one real bug this
  surfaced and fixed (ARM `DELETE` empty-body handling).
- **Frontend shows the real gateway, not a mock** (Phase 5): `/models/{slug}`, the research
  connect journey's credential page, and `/manage/credentials/{id}` build the real APIM request
  (`src/server/common/helpers/gateway-request.js`, `GATEWAY_BASE_URL` config) keyed off each
  model's `apiProfile` — `chat-completions` gets the deployment-scoped chat completions shape,
  `responses` gets the model-as-body-field shape, matching what the live smoke test above actually
  verified. The catalogue pages (`/models`, `/models/{slug}`) now also show ineligible/retired
  models greyed out with their `eligibilityReason`/`lifecycle.status` instead of hiding them
  (backend `GET /v1/models?includeIneligible=true`, used by the catalogue browse page only — the
  connect journeys still get eligible-only results by default). A new audited view-credential
  journey, `/manage/credentials/{id}/view`, lets a research credential's owner or a team admin
  re-reveal the full secret with a required reason, via the backend's
  `POST /v1/credentials/{id}/reveal`. See
  [research-tier-integration-plan.md](plans/implemented/integration/research-tier-integration-plan.md)'s Phase 5.
- **Security baseline**: structured JSON logging with no PII (`hapi-pino` + ECS format), CSP via
  Blankie, CSRF via `@hapi/crumb`, session cookies via `@hapi/yar` (all frontend); Joi validation
  rejecting unknown keys on every backend route.

## Where to go next

- [docs/ui-flow-three-routes.md](ui-flow-three-routes.md) — the end-to-end flow this whole journey implements.
- [docs/plans/](plans/) — one plan per route, each with a `STATUS` line and the detailed step-by-step build history.
- `ai-platform-discovery-docs/src/content/design-*.md` — the platform-wide design pack (environments, orchestration, repositories/pipelines, infrastructure, identity, teams, observability) this journey is built against.
- Each repo's README (`ai-platform-frontend/README.md`, `ai-platform-backend-api/README.md`) — setup, testing, and shared dev helpers (locks, backfills, proxy).

# Implemented features

A single, cross-repo list of what has actually been built so far in the AI Platform Portal (
`ai-platform-frontend` + `ai-platform-backend-api`), for new joiners to get oriented quickly. This
is a summary/index, not the source of truth — every item below links to the plan doc, README
section or design-pack page that has the full detail, and those are what you should read (and
update) when you touch the feature. Do not copy detail out of those documents into this file; keep
this page to short bullet points.

Last updated: 5 Oct 2026 (in-process credential expiry scheduler; APIM policy expiry backstop merged into the research API policy; issue()/renew() now keep APIM's expirationDate in sync with Mongo; re-issuing for a model with an expired credential now points the user to renew instead of silently reissuing).

## Journey status at a glance

The core product journey is "three routes to a credential" — see
[docs/ui-flow-three-routes.md](ui-flow-three-routes.md) for the full flow and
[docs/plans/](plans/) for the build plan behind each route.

| Route                                   | Covers                                                                                                 | Status                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [Route 0](plans/route0-welcome-plan.md) | Home page (`/`), the shared entry point into the other three                                           | **Implemented** (29 Sept 2026, flat design build spec)                                          |
| [Route 1](plans/route1-plan.md)         | Research tier: browse the model catalogue, request a personal shared-model credential, manage it       | **Implemented** (22 Sept 2026)                                                                  |
| [Route 2](plans/route2-plan.md)         | Team tier: create/select a team, request a dedicated model deployment for it                           | **Implemented** (23 Sept 2026, refactored 25 Sept 2026 to match the discovery-docs design pack) |
| [Route 3](plans/route3-plan.md)         | Team tier: joining a team that already has access, admin-vs-user role enforcement, credential rotation | **Implemented** (25 Sept 2026)                                                                  |

## Route 1 — Research tier shared model access

- Sign in with Defra Entra ID (OIDC), session-backed.
- Browse the model catalogue: `/models` (list) and `/models/{slug}` (detail) — backend `GET /v1/models`.
- Request a credential for a shared model: `/connect/shared/*` (model choice, purpose + terms step,
  one-time secret reveal) — backend `POST /v1/credentials` (`tier: 'research'`).
- `/manage` — view your own credentials, renew (within a renewal cap), revoke.
- Backend: `users`, `models`, `credentials` routes/services; subscription-key credentials with a
  configurable TTL and renewal cap; lazy expiry (a credential flips to `expired` the next time it's
  read past its `expiresAt`, not via a background sweep).

## Route 2 — Team tier, first person in a team

- Create or select a team: `/teams/new`, `/teams/{id}`.
- Request a dedicated model deployment for the team: `/connect/team/*`.
- Backend: `teams`, `teamMembers`, `teamDeployments` collections; a `TenantOrchestrator` port
  (mocked) drives the slow "provision the team's stack" path; one **shared credential per team per
  environment** (not per model) once the deployment reaches `active`, covering every requested
  model via `allowedDeployments[]`; credential type (`oauth` or `subscription-key`) is fixed on
  first use per team per environment (`credential-type-fixed`).
- Team-facing environment today is `sandbox` only (Phase 1 — see
  [design-environments.md#phase-1](../../ai-platform-discovery-docs/src/content/design-environments.md)).

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
- `/manage` restructured from per-team tabs to one merged "Keys you can use" table (personal +
  team credentials together) plus a flat "Being set up" table and a plain-text "Your teams" list.
- Home page (`/`) now has real content for both signed-out and signed-in visitors (was a
  placeholder) — see the Route 0 status above.

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
  `credential-issuer-registry` resolved per model (new credentials) or per already-issued credential
  (via its persisted `issuerKey`) — a `mock` adapter (default) and a real Azure APIM adapter talking
  to the ARM management plane (`src/adapters/azure/`, `ai-platform-backend-api`), selected by the
  `PROVISIONING_MODE` config flag (production refuses to start on `mock`). `TenantOrchestrator`
  (GitOps-style team/model provisioning) is still mock-only. See
  [research-tier-integration-plan.md](plans/integration/research-tier-integration-plan.md)'s Phase 1.
- **MongoDB write locks** (`mongo-locks`, `server.locker`/`request.locker`) guard every non-atomic
  multi-step write (team creation, credential issuance, deployment status transitions).
- **Schema backfills**: a self-applying, one-off data migration mechanism
  (`src/common/backfills/`) added 25 Sept 2026 — see backend README's "Schema backfills" section.
- **Model catalogue synced from a `CatalogueSource` port**: a `file` adapter (default - reads
  `src/common/seed/{models,providers}.seed.json`, so tests/compose need no network) and a `github`
  adapter (Octokit, reads `ai-platform-infra`'s `catalogue/` at a pinned release tag, with ETag
  caching and a last-good-mirror fallback on any failure), selected by `CATALOGUE_SOURCE`. Synced
  into MongoDB on every backend start (`syncCatalogue`, `ai-platform-backend-api`) with
  `catalogueSha`/`release`/`syncedAt`; models no longer present in the source are retired
  (`eligible: false`, `lifecycle.status: 'retired'`), never deleted. `ai-platform-infra`'s
  `catalogue/` now holds real content (8 Foundry-deployment models + 1 provider), tagged `v0.1.0`.
  Per-model `apiProfile` (`chat-completions` vs `responses`) drives both the frontend's gateway URL
  shape (`gateway-request.js`) and the backend's `apiVersion` default: a `responses`-profile model
  is always pinned to `2025-03-01-preview` regardless of what the catalogue source supplies for
  that field (verified against the real sandbox gateway — `responses` 404s on the older
  chat-completions-era default even when the source says otherwise), since `chat-completions` isn't
  supported at all for a responses-only model. `models.seed.json` (the local `file` source) now
  includes one `responses`-profile model (`gpt-5-3-codex`) so this path is exercised without GitHub
  catalogue access. See [research-tier-integration-plan.md](plans/integration/research-tier-integration-plan.md)'s Phase 2.
- **Credential secrets persisted to Key Vault, with an audited reveal**: a `CredentialVault` port
  (`issue`/`rotate` write through it, `renew` updates the existing secret version's expiry in place
  via `updateExpiry` rather than rotating it, `revoke` soft-deletes) behind a `mock` adapter
  (default, in-memory) and a real Azure Key Vault adapter (`@azure/keyvault-secrets`,
  `ai-platform-backend-api`), selected by the same `PROVISIONING_MODE` flag as the credential
  issuer. A vault write/expiry-update failure never fails the request (the user already has the
  secret) — it flags the credential `vaultState: 'unwritten'` instead, retried by the existing
  `reconcilePendingCredentials` maintenance job (which re-writes the secret using the already-
  updated Mongo `expiresAt`). `POST /v1/credentials/{id}/reveal` lets an owner (research tier) or
  team admin (team tier) re-view an already-issued secret, audited with a required reason,
  `Cache-Control: no-store`. See
  [research-tier-integration-plan.md](plans/integration/research-tier-integration-plan.md)'s Phase 3.
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
  [research-tier-integration-plan.md](plans/integration/research-tier-integration-plan.md)'s Phase 5.
- **Security baseline**: structured JSON logging with no PII (`hapi-pino` + ECS format), CSP via
  Blankie, CSRF via `@hapi/crumb`, session cookies via `@hapi/yar` (all frontend); Joi validation
  rejecting unknown keys on every backend route.

## Where to go next

- [docs/ui-flow-three-routes.md](ui-flow-three-routes.md) — the end-to-end flow this whole journey implements.
- [docs/plans/](plans/) — one plan per route, each with a `STATUS` line and the detailed step-by-step build history.
- `ai-platform-discovery-docs/src/content/design-*.md` — the platform-wide design pack (environments, orchestration, repositories/pipelines, infrastructure, identity, teams, observability) this journey is built against.
- Each repo's README (`ai-platform-frontend/README.md`, `ai-platform-backend-api/README.md`) — setup, testing, and shared dev helpers (locks, backfills, proxy).

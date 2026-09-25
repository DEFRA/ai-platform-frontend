# Implemented features

A single, cross-repo list of what has actually been built so far in the AI Platform Portal (
`ai-platform-frontend` + `ai-platform-backend-api`), for new joiners to get oriented quickly. This
is a summary/index, not the source of truth — every item below links to the plan doc, README
section or design-pack page that has the full detail, and those are what you should read (and
update) when you touch the feature. Do not copy detail out of those documents into this file; keep
this page to short bullet points.

Last updated: 25 Sept 2026.

## Journey status at a glance

The core product journey is "three routes to a credential" — see
[docs/ui-flow-three-routes.md](ui-flow-three-routes.md) for the full flow and
[docs/plans/](plans/) for the build plan behind each route.

| Route | Covers | Status |
| --- | --- | --- |
| [Route 0](plans/route0-welcome-plan.md) | Home page (`/`), the shared entry point into the other three | **Not yet implemented** — placeholder page only |
| [Route 1](plans/route1-plan.md) | Research tier: browse the model catalogue, request a personal shared-model credential, manage it | **Implemented** (22 Sept 2026) |
| [Route 2](plans/route2-plan.md) | Team tier: create/select a team, request a dedicated model deployment for it | **Implemented** (23 Sept 2026, refactored 25 Sept 2026 to match the discovery-docs design pack) |
| [Route 3](plans/route3-plan.md) | Team tier: joining a team that already has access, admin-vs-user role enforcement, credential rotation | **Implemented** (25 Sept 2026) |

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

## Cross-cutting platform features

These aren't tied to one route — they're shared infrastructure every route above depends on.

- **Credential lifecycle**: issue / renew / rotate / revoke, lazy expiry on read, plus two
  background-style maintenance operations (`expireCredentials`, `reconcilePendingCredentials`)
  exposed via a token-gated `/maintenance/expire-credentials` endpoint (see backend README's
  "Development helpers").
- **Idempotency**: every credential/team/team-deployment creating endpoint requires an
  `Idempotency-Key` header; replays return the original result rather than creating a duplicate.
- **Audit events**: every state-changing action records a `recordAuditEvent` entry (actor, action,
  resource, outcome) in a TTL-expiring `auditEvents` collection — never a secret.
- **Mocked external integrations behind ports**: `CredentialIssuer` (issue/renew/rotate/revoke/
  suspend against Azure APIM) and `TenantOrchestrator` (GitOps-style team/model provisioning) are
  both interfaces with mock adapters selected by config — no real Azure/APIM integration exists yet.
- **MongoDB write locks** (`mongo-locks`, `server.locker`/`request.locker`) guard every non-atomic
  multi-step write (team creation, credential issuance, deployment status transitions).
- **Schema backfills**: a self-applying, one-off data migration mechanism
  (`src/common/backfills/`) added 25 Sept 2026 — see backend README's "Schema backfills" section.
- **Model catalogue is config/seed-data driven**: idempotently upserted from
  `src/common/seed/models.seed.json` on every backend start, not hard-coded.
- **Security baseline**: structured JSON logging with no PII (`hapi-pino` + ECS format), CSP via
  Blankie, CSRF via `@hapi/crumb`, session cookies via `@hapi/yar` (all frontend); Joi validation
  rejecting unknown keys on every backend route.

## Where to go next

- [docs/ui-flow-three-routes.md](ui-flow-three-routes.md) — the end-to-end flow this whole journey implements.
- [docs/plans/](plans/) — one plan per route, each with a `STATUS` line and the detailed step-by-step build history.
- `ai-platform-discovery-docs/src/content/design-*.md` — the platform-wide design pack (environments, orchestration, repositories/pipelines, infrastructure, identity, teams, observability) this journey is built against.
- Each repo's README (`ai-platform-frontend/README.md`, `ai-platform-backend-api/README.md`) — setup, testing, and shared dev helpers (locks, backfills, proxy).

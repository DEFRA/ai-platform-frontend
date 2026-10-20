# 06 Shared services and security

Behaviour every route depends on. All built and merged.

| Feature                                      | Built        |
| -------------------------------------------- | ------------ |
| Idempotency on every creating endpoint       | Sept 2026    |
| Audit events (never a secret)                | Sept 2026    |
| MongoDB write locks around multi-step writes | Sept 2026    |
| Self-applying schema backfills               | 25 Sept 2026 |
| Federated backend-to-Azure sign-in           | 13 Oct 2026  |
| Security baseline                            | Sept 2026    |

## Shared services

- **Idempotency.** Every credential, team and team-deployment creating endpoint requires an `Idempotency-Key`; a replay
  returns the original result.
- **Audit.** Every state change calls `recordAuditEvent` (actor, action, resource, outcome) into a TTL-expiring
  `auditEvents` collection. A reveal also records its reason.
- **Locks.** `mongo-locks` (`server.locker`) guard team creation, role changes, credential issue, and deployment status
  transitions. A lock is always released in `finally`.
- **Backfills.** A one-off data migration runs at start-up (`src/common/backfills/`, claim and lease design) and a
  persisted field is added with a dated backfill, so an old document does not silently lack it. See the backend README
  "Schema backfills" and `.github/instructions/schema-changes.instructions.md`.
- **Maintenance.** Token-gated `/maintenance/*` routes (`x-maintenance-token`) and an in-process scheduler
  (`MAINTENANCE_SCHEDULER_ENABLED`, every five minutes) run credential expiry, pending reconciliation and the GitOps sweep.

## Security

- Structured JSON logs with no personal data (`hapi-pino` and ECS format); no secret in any log line or audit event.
- A credential secret is returned only at creation and rotation, and re-shown only by the audited reveal; `keyHint`
  (last four characters) everywhere else.
- CSP through Blankie with no `unsafe-inline` or `unsafe-eval`; CSRF through `@hapi/crumb`; session cookies through
  `@hapi/yar`.
- Joi on every backend route, rejecting unknown keys; MongoDB queries use the driver's query objects only.
- No public ingress to the backend; it is reachable only inside the CDP network, and identity is the internal user header
  (a gap, see [../remaining.md](../remaining.md)).
- Backend-to-Azure: `AZURE_ARM_AUTH_METHOD=federated` builds a `ClientAssertionCredential` over `@defra/hapi-auth-oidc`'s
  `WebIdentityTokenProvider` (the STS audience is sent as a list); `client-secret` is for local use only.

# 06 Shared services and security

Behaviour every route depends on. All built and merged.

| Feature                                      | Built        |
| -------------------------------------------- | ------------ |
| Idempotency on every creating endpoint       | Sept 2026    |
| Audit events (never a secret)                | Sept 2026    |
| MongoDB write locks around multi-step writes | Sept 2026    |
| Self-applying schema backfills               | 25 Sept 2026 |
| Federated backend-to-Azure sign-in           | 13 Oct 2026  |
| Portal sign-in and API access (B27)          | 4 Nov 2026   |
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
- No public ingress to the backend; it is reachable only inside the CDP network, and every route except `/health` and the
  maintenance route needs an Entra access token (B27, below).
- Backend-to-Azure: `AZURE_ARM_AUTH_METHOD=federated` builds a `ClientAssertionCredential` over `@defra/hapi-auth-oidc`'s
  `WebIdentityTokenProvider` (the STS audience is sent as a list); `client-secret` is for local use only.

## Portal sign-in and API access (B27)

Built 4 Nov 2026 in HVE #42: merged to nothing yet, so **built, not released and not deployed**. Direction and every
token check are in discovery-docs design E `#portal`; acceptance criteria in `build-stories.md#b27`. What is left (the
journey tests, the joint deploy to CDP `dev` and deleting the client secret) is in [remaining.md](../remaining.md).

- **Sign-in, frontend.** Authorisation code flow with PKCE. The frontend proves itself to Entra with a CDP Web Identity
  client assertion (`AZURE_AUTH_METHOD=federated`, `AZURE_FEDERATED_AUDIENCE`), never a secret outside `localhost`; tokens
  stay in the Redis session. `common/helpers/oidc-client.js` is the one client-authentication function (code, refresh and
  client-credentials grants), `access-token.js` refreshes the person's token two minutes before expiry and caches the app
  token, and `api-client.js` is the only way to call the backend: the person's access token when signed in, the app token
  for the two catalogue reads before sign-in, no `x-user-id`, and a 401 ends the session. Variables are in the frontend
  README ("Local sign-in").
- **Sessions, frontend.** The session ID is renewed at sign-in; 30 minutes idle and 8 hours absolute
  (`require-sign-in-globally.js`, `session-lifetime.js`); background status polling does not keep a session open;
  `Cache-Control: no-store` on signed-in pages; a timeout dialog with JavaScript and a signed-out page without.
- **Authentication, backend.** `src/plugins/auth.js` (`@hapi/jwt`, `RS256`, tenant keys fetched through the CDP proxy at
  start-up, which refuses to start without them) and `common/helpers/auth/identity.js` validate every token before any
  handler: `tid`, `aud`, `iss`, `ver`, `azp`, `azpacr`, the 2 hour `iat` to `exp` ceiling, then the type from `idtyp` and
  `scp`. A person's token also needs `acct` 0 and a `users` record; an app token is accepted on `GET /v1/models` and
  `GET /v1/models/{slug}` only. Failure is `401 invalid-token` with `WWW-Authenticate`.
- **Authorisation, backend.** `access.js` is the only rights check (404 non-member, 403 `admin-required` or
  `platform-admin-required`, every refusal audited); each route declares its access and a test lists them all
  (`route-access.test.js`). Background work acts as the system actor (`actorUserId` `app:ai-platform-backend`; expiry audit
  records are found by `resourceId`). Audit records add `tid`, `azp`, `uti` and the role used, never a token.
- **People.** `PUT /v1/users/me` upserts from the token's claims (no body) and returns 200 `{ user, team }`;
  `POST /v1/users`, `x-user-id`, the backend's `allowedEmailDomains` and the CDP template `/example` routes are removed.
  The frontend keeps its sign-in gate on the ID token claims (a guest, or an address off `ALLOWED_EMAIL_DOMAINS`; frontend
  PR #80), which runs before the backend checks the access token. Team
  invitations and email binds were not changed (backend PR #64, frontend PR #80, item #65).
- **Local.** The mock provider (`dev/mock-oidc-provider.js`) issues Entra-shaped access tokens and a client-credentials
  token; the backend trusts it through `PORTAL_AUTH_MOCK_ISSUER_URL`, refused in production.
- **Dependency.** `@defra/hapi-auth-oidc` stays at 0.6.0 with a `joi` override until 10 Nov 2026 16:19 UTC (see
  [remaining.md](../remaining.md)).

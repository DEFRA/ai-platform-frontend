# 06 Shared services and security

Behaviour every route depends on. All built and merged.

| Feature                                      | Built                           |
| -------------------------------------------- | ------------------------------- |
| Idempotency on every creating endpoint       | Sept 2026                       |
| Audit events (never a secret)                | Sept 2026                       |
| MongoDB write locks around multi-step writes | Sept 2026                       |
| Self-applying schema backfills               | 25 Sept 2026                    |
| Federated backend-to-Azure sign-in           | 13 Oct 2026                     |
| Portal sign-in and API access (B27)          | 4 Nov 2026, deployed 5 Nov 2026 |
| Security baseline                            | Sept 2026                       |

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

Built 4 Nov 2026 in HVE #42 and released 5 Nov 2026 (frontend 0.67.0, backend 0.57.0). **Deployed and validated in CDP
`dev`, as confirmed by the user on 5 Nov 2026** ("all deploy and gateway validation passed already, i tested it in cdp
works all fine"); no run identifiers were supplied. Direction and every token check are in discovery-docs design E
`#portal`; acceptance criteria in `build-stories.md#b27`. Decisions, evidence and small follow-ups are at the foot of this file.

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
  [the follow-ups below](#b27-decisions-and-evidence)).

## B27 decisions and evidence

Moved from `remaining.md` when B27 was recorded as done (5 Nov 2026).

**Follow-ups outside the story's acceptance**

- **Dependency.** After 10 Nov 2026 16:19 UTC (the 7-day package-age rule), run
  `npm install --save-exact @defra/hapi-auth-oidc@0.6.1`, remove the `overrides` block in `package.json`, run
  `npm install --package-lock-only`, and keep `test-helpers/dependencies.test.js` green.
- **Client secret.** Confirm the client secret is deleted from the registration and from CDP (not recorded either way).
- **First Platform Admin.** Finding 8 of the 22 October review is open: nothing assigns `PLATFORM_ADMIN_ROLE`, so the

**Open decision.** The frontend still refuses an account at the sign-in callback from the ID token claims (a guest, or
an address off `ALLOWED_EMAIL_DOMAINS`), as frontend #80 built it, before the backend checks the access token (`tid`,
`acct`, `scp`). B27's acceptance criterion says the tenant check replaces the email-domain allow-list; keeping both is
the cautious merge. Decide whether to retire the frontend rule.

Kept as built: PKCE `S256` with `state` and `nonce`; ID token validation by `openid-client`; the server-side `yar`
session (`maxCookieSize: 0`); the deny-by-default sign-in gate with explicit `app.public`; `@hapi/crumb`; the Blankie
CSP; the safe `returnTo`; Joi on every route; a non-member learns nothing about a team (404) and a member without the
right gets a stable 403 code such as `admin-required`; audit with a 30-day TTL; the maintenance route and its token;
`authorization` and `cookie` headers redacted from production logs in both services.

**Decisions and evidence (checked 22 October 2026)**

| Decision                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every deployed frontend federates; a secret only on an optional `app-aip-portal-local`, at most three months                                                                                                | Defra's [Entra guide](https://defra.github.io/software-development-standards/guides/entra/) prefers federated credentials on CDP; [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) section 2.5; the backend already federates for ARM (`azure-credential.js`)                                                                                                                                                                                                                             |
| Two registrations per instance: `app-aip-portal-{instance}` (client) and `api-aip-portal-{instance}` (audience)                                                                                             | Microsoft's app-calling-API pattern ([app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)); a distinct audience stops an ID token passing as an access token ([RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html) section 3.12; RFC 9700 section 2.3). Not CDP portal's single registration exposing its own scope. A token for one instance fails every other instance's audience check, so a token is only ever valid in its own environment |
| The frontend forwards the person's delegated token; the backend keys people on `oid` and `tid` and checks `scp`                                                                                             | [Claims validation](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation); an app token plus a user header is the same trust-the-header flaw; [ASVS 5.0 V10](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x19-V10-OAuth-and-OIDC.md) 10.3.1 to 10.3.4; ASVS 8.3.3 (decide on the originating person's rights, not an intermediary's)                                                                                                                                 |
| One app-only exception: the frontend's client-credentials token on the two catalogue reads, authorised by `azp` and `idtyp`                                                                                 | Public pages call `/v1/models` before sign-in; claims validation allows authorising one application by `azp` when `idtyp` is `app`                                                                                                                                                                                                                                                                                                                                                               |
| No custom Entra app roles or groups in the first build; Platform Admin and team rights stay in MongoDB                                                                                                      | Requester, 22 October 2026; Microsoft advises keeping fine-grained rights in the application (app roles). A role can be added to the API registration later without changing the frontend                                                                                                                                                                                                                                                                                                        |
| Rights checked in one module; a non-member gets 404, a member without the right 403; every refusal audited                                                                                                  | [ASVS 5.0 V8](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md) 8.2.2 (object-level checks against IDOR) and 8.3.1 (enforced at a trusted service layer); [V16](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) 16.3.2 (failed authorisation logged); hiding a resource from non-members keeps the existing behaviour                                                                                                 |
| Claims kept: on the person `oid`, `tid`, `email` and `name` (display) and the last sign-in; on each audit record `tid`, `azp`, `uti` and CDP's request ID. Never a token, `ipaddr`, groups or anything else | Claims validation (the subject is `oid` with `tid`); UK GDPR data minimisation ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/)); `uti` ties an audit record to Entra's sign-in logs                                                                                                                                                                                          |
| Eligibility from `tid` and `acct: 0`, replacing the email-domain allow-list                                                                                                                                 | [Optional claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference) (`acct` 0 member, 1 guest); `email` is mutable (claims validation); B03 intended a `tid` check                                                                                                                                                                                                                                                                                            |
| Tokens only in the server-side session; refresh before expiry, storing the replaced refresh token                                                                                                           | ASVS 10.1.1; [refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens) (90 days for confidential clients, replaced on use)                                                                                                                                                                                                                                                                                                                                      |
| Session ID renewed at sign-in; 30 minutes idle, 8 hours absolute; `Cache-Control: no-store` signed in; `Clear-Site-Data` out                                                                                | [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)                                                                                                                                                                                                                                                                                                                                                                                   |
| Libraries: keep `openid-client` 6.8.8; add `@defra/hapi-auth-oidc` 0.6.0 to the frontend for `WebIdentityTokenProvider` only; add `@hapi/jwt` 3.2.4 to the backend                                          | All latest on npm. `openid-client` is OpenID-certified, in use, and takes a custom client-authentication function. The backend already pins `@defra/hapi-auth-oidc` for the same provider. `@hapi/jwt` is the hapi JWT scheme Defra CDP services such as `epr-backend` and the `forms-*` services already use. Not chosen: MSAL Node (replaces a working certified client) and the `@defra/hapi-auth-oidc` plugin (pre-1.0, with its own cookie handling beside our Redis session)               |

**Agreed on 22 October 2026:** the first Platform Admin is set by hand; the maintenance route stays as built; a stolen
access token stays valid until it expires, accepted because tokens never leave the server-side session and CDP's
network is private; Terraform, other upgrades and sign-in policies such as MFA are out of scope.

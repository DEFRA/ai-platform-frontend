# Remaining work

Everything not yet built, in one place. What is built is in [implemented/](implemented/). Story identifiers (B01 to B27)
are those of `ai-platform-discovery-docs` `build-stories.md`, the authority for acceptance criteria; the design pack
(`design-*.md`) is the authority for direction. State on 22 Oct 2026; B28 rows on 30 Oct 2026. The table mirrors `build-stories.md#status`: every story not fully built there, and each unbuilt part of a built story, has a row here stating the same.

## At a glance

| Section | Category                 | Item                                                                                                                                                                                                                                                                                 | State                                                  | Blocked by                              |
| ------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------- |
| 1       | Identity and credentials | B18: real team client secret and federations                                                                                                                                                                                                                                         | Not started (placeholder built)                        | Entra admin consent                     |
| 1       | Identity and credentials | B27: federated sign-in; backend validates an Entra token on every route                                                                                                                                                                                                              | Planned: decided 22 Oct; nothing built                 | Entra objects (by hand)                 |
| 1       | Identity and credentials | B15: Entra consent, `entra.enabled` back on in Infradev                                                                                                                                                                                                                              | Not started                                            | Entra admin consent                     |
| 2       | Limits and reporting     | B17: limits page and increase requests                                                                                                                                                                                                                                               | Not started                                            | None                                    |
| 2       | Limits and reporting     | B19: team usage and chargeback                                                                                                                                                                                                                                                       | Not started                                            | Agreed tariff and period                |
| 3       | Observability            | B20 to B22: telemetry, dashboards, alerts                                                                                                                                                                                                                                            | Not started (infra groundwork only)                    | None; gates creating DEV                |
| 4       | Gateway                  | B23: gateway authorisation layers                                                                                                                                                                                                                                                    | Partly built: global gateway guard (infra #16, v0.8.0) | Check the other layers against the code |
| 5       | Research tier            | R8: journey tests and security pass                                                                                                                                                                                                                                                  | Not started                                            | None                                    |
| 5       | Research tier            | B04: ARM liveness reconcile, live deployment status (integration plan Phase 4)                                                                                                                                                                                                       | Deferred by decision                                   | A decision to start it                  |
| 5       | Research tier            | Narrow the backend's Azure roles; lock the vault to CDP egress                                                                                                                                                                                                                       | Not started                                            | CDP egress ranges                       |
| 6       | Quality and delivery     | Phase 0 (story status restructure); Phase 1 is B01 and B02 below                                                                                                                                                                                                                     | Not started                                            | None                                    |
| 6       | Quality and delivery     | B01: SonarCloud scan, coverage thresholds, checkov soft-fail, Dependabot example, `azure` alias                                                                                                                                                                                      | Built; gaps remain                                     | None                                    |
| 6       | Quality and delivery     | B02: a journey run against an environment, axe at WCAG 2.2 AA, no-JavaScript journeys                                                                                                                                                                                                | Started                                                | None                                    |
| 7       | Platform operations      | B24, B25: platform promotion with pinned settings, plans before merge (discovery-docs #27)                                                                                                                                                                                           | Planned: decided 20 Oct; none built                    | None                                    |
| 7       | Platform operations      | B15: `reconcile-all` and `infradev-reset` workflows; merged lifecycle rules, destroy cap and locks not yet checked as applied                                                                                                                                                        | Built in Infradev; gaps remain                         | None                                    |
| 7       | Platform operations      | B16: portal path to the two-step team removal (decommission)                                                                                                                                                                                                                         | Not started                                            | Owners                                  |
| 7       | Platform operations      | Dev proxy rule for GitHub artifacts                                                                                                                                                                                                                                                  | PR open (cdp-tenant-config #2024)                      | CDP platform team review                |
| 7       | Platform operations      | B26: Terraform quality bar (T1 to T9, Q1 to Q8)                                                                                                                                                                                                                                      | Planned                                                | None                                    |
| 7       | Platform operations      | B28: asynchronous GitOps operations; plan in discovery-docs `docs/async-operations-plan.md`                                                                                                                                                                                          | Partly built 28 and 29 Oct; the rows below remain      | None                                    |
| 7       | Platform operations      | B28: journey tests (multi-model, progress with and without script, `checks-failed`, `deploy-failed`)                                                                                                                                                                                 | PR open (journey tests #11)                            | Review                                  |
| 7       | Platform operations      | B28: end-to-end check in Infradev                                                                                                                                                                                                                                                    | Not started                                            | B28 journey tests                       |
| 7       | Platform operations      | Automate the GitOps message-schema re-sync (worker and backend); options A to D, recommend A then B                                                                                                                                                                                  | Not started                                            | None                                    |
| 7       | Platform operations      | B28: `settings-drift` that works: `--verify` warns on hidden bypass lists, `AIP_SETTINGS_AUDIT_TOKEN` set, plan section 15 mitigations 2 and 4 recorded; low priority, before any environment beyond Infradev                                                                        | Not started                                            | Organisation owner (audit log)          |
| 7       | Platform operations      | Admin tasks, other environments, decommission path                                                                                                                                                                                                                                   | Not started                                            | Owners                                  |
| 9       | Record                   | Discovery-docs built-state refresh: infra and workflows rows (B15, B20 to B26) and the real Azure note                                                                                                                                                                               | Partly done 22 Oct (#31)                               | None                                    |
| -       | UI flow v3               | B13: Email a person added to a team (GOV.UK Notify adapter behind a port, key in the vault, one template); the add-member inset then adds "We will email them to say they have been added."                                                                                          | Deferred, not removed                                  | A decision to start it                  |
| -       | UI flow v3               | B09: Backend support reference for a failed set-up, in the support link, with an automatic alert to the platform team (B22 channel); replaces the frontend `AIP-` reference built from `operationId`                                                                                 | Deferred, not removed                                  | B22 alert channel                       |
| -       | UI flow v3               | Environments page ([mock-up](../flat-design-updates/environment/)): release pipeline across Development, Test, Pre-production and Production, promotion via `promotedFrom`, health and checks, Production approvals, capacity, audit, usage; then `environmentSetUpUrl` points there | Not started                                            | Design sign-off                         |
| -       | UI flow v3               | B09: Test environment: `qa` estate, `TEAM_ENVIRONMENTS` and `AIP_ENVIRONMENTS` in both repositories, registry entry, tenants and deployments folders; until then Test reads "not available yet" (Set up Test is built behind that config)                                            | Not started                                            | `qa` subscription                       |
| -       | UI flow v3               | B18: Team secret expiry per environment (with B18: at most 3 months in DEV and QA, a year in PREPROD and PROD); the team Models tab already shows "Expires {date}" once the backend sets `expiresAt`                                                                                 | Not started                                            | Entra admin consent (B18)               |
| -       | UI flow v3               | B08: Backend reserves the team slug `new`, which clashes with `/teams/new` (a team named "New" has no page by slug until then); follow-up on backend PRs #50 to #52                                                                                                                  | Not started                                            | Backend change                          |
| -       | UI flow v3               | B07: Renewal cap, the frontend's `RESEARCH_RENEWAL_CAP` (3) is hard-coded and must match the backend's `research.renewalCap`; read it from the backend instead                                                                                                                       | Not started                                            | Backend exposing the cap                |
| -       | UI flow v3               | B06: "Get a new key" for an expired key at the renewal cap may be refused by the backend (`credential-expired-use-renew`)                                                                                                                                                            | Open                                                   | Backend decision to allow a new key     |
| -       | UI flow v3               | B14: Real service-code verification; until then the team Details tab shows "Not checked yet" for every team                                                                                                                                                                          | Not started                                            | An authoritative source agreed          |
| -       | UI flow v3               | B02: Journey tests and selectors in `ai-platform-journey-tests` for the new pages (build plan step 14): Models, team request, Teams and Models tab, Your access, Members, Details, Set up Test, Home                                                                                 | Not started                                            | None                                    |
| -       | UI flow v3               | B06: Infra, the tenants research file deploys only gpt-4o in infradev while the catalogue lists research SKUs on gpt-4-1-nano and gpt-5-nano, so those two show "Not available" to try on your own (owner infra/tenants)                                                             | Open                                                   | A decision to deploy them               |

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

### B27 Portal sign-in and API access

Decided 22 October 2026; nothing built. One plan for both portal repositories: the backend half (P1) makes the API
refuse every call without a valid Entra token and every action the caller has no right to; the frontend half (P2) sends
that token. Direction and every token check are in discovery-docs design E `#portal`, the acceptance criteria in
`build-stories.md#b27`. Entra objects are created by hand now and by Terraform later. Out of scope: B18, B23 and other
dependency upgrades. Nothing turns authentication off: locally, the mock provider issues real tokens and the same
validation runs.

**How it fits together**

1. **Sign-in, frontend.** Authorisation code flow with PKCE. The frontend proves itself to Entra with a CDP Web
   Identity client assertion, never a secret, and keeps the tokens in the Redis session.
2. **Every backend call, frontend.** `api-client.js` attaches the person's access token and refreshes it before it
   expires. Before sign-in, the two catalogue reads carry the frontend's own app token instead.
3. **Authentication, backend.** `auth.js` validates the token before any handler runs, with every check in design E
   `#portal`, and `identity.js` turns it into one actor: `oid`, `tid`, the person's record and the audit fields. No
   token, or a bad one, is 401 `invalid-token`.
4. **Authorisation, backend.** Each route declares who may call it, and `access.js` checks team and Platform Admin
   rights against the resource. A missing right is 403, another team's resource is 404, and every refusal is audited.

The backend's `auth.js`, `identity.js` and `access.js` are the pattern for any later portal service: it gets its own
audience and reuses them unchanged.

**Backend enforcement, route by route**

| Route                                                                   | Token                                                | Right                                                          |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `GET /health`                                                           | None                                                 | None (CDP's probe)                                             |
| `POST /maintenance/expire-credentials`                                  | None; its own `x-maintenance-token`, as B04 built it | None                                                           |
| `GET /v1/models`, `GET /v1/models/{slug}`                               | A person's, or the frontend's app token              | None                                                           |
| `PUT /v1/users/me`, replacing `POST /v1/users`                          | A person's                                           | Themselves only, from the token's claims; no body              |
| `GET /v1/users/me`                                                      | A person's                                           | Themselves only                                                |
| `POST /v1/credentials`                                                  | A person's                                           | Research: any eligible person. Team: an active member          |
| `GET /v1/credentials`, `GET /v1/credentials/{id}`                       | A person's                                           | The research credential's owner, or a member of its team       |
| `POST /v1/credentials/{id}/renew`                                       | A person's                                           | The research credential's owner; team credentials do not renew |
| `POST .../rotate`, `POST .../reveal`, `DELETE /v1/credentials/{id}`     | A person's                                           | The research credential's owner, or an Admin of its team       |
| `POST /v1/teams`, `GET /v1/teams`                                       | A person's                                           | Any person; the list holds only their teams                    |
| `GET /v1/teams/{id}`                                                    | A person's                                           | A member                                                       |
| `PATCH /v1/teams/{id}`; `POST`, `PATCH` and `DELETE` on its members     | A person's                                           | An Admin; the last Admin is never removed or demoted           |
| `POST` and `GET /v1/teams/{teamId}/deployments`, `GET .../{id}`         | A person's                                           | A member                                                       |
| `DELETE /v1/teams/{teamId}/deployments/{id}`                            | A person's                                           | An Admin                                                       |
| `POST /v1/admin/team-deployments/{id}/retry`, `POST .../{id}/reconcile` | A person's                                           | Platform Admin, the database role                              |
| `/example`, `/example/{exampleId}`                                      | Removed                                              | Removed                                                        |

The rights are the ones the services enforce today; B27 adds the token and moves the checks into `access.js`. A test
lists every route with its declared access, so a new route fails until it declares one.

**Team invitations.** An Admin invites a member by Defra email, and the membership binds to the person at their next
sign-in (design F `#membership`). Today `addMember` stores the invitation with `userId: null` and `upsertUser`
activates it from whatever email `POST /v1/users` is sent. P1 keeps the binding but makes it safe:

- It runs only inside `PUT /v1/users/me`, after a valid token from a member of the Defra tenant (`tid`, `acct: 0`), and
  only for invitations whose email equals the token's `email` claim.
- Each invitation binds once: one atomic update moves it from `invited` with no `userId` to `active` with the person's
  `userId`, and the binding is audited with the team and `uti`. A bound invitation never moves to another person, and
  the email grants nothing after that.
- Two members cannot hold the same address at once: Entra keeps `proxyAddresses` unique across a tenant's users,
  groups and contacts and refuses a clashing `mail`
  ([user resource](https://learn.microsoft.com/en-us/graph/api/resources/user), checked 22 October 2026). The
  remaining risk is a directory administrator reassigning an address while an invitation is still pending; the Admin
  sees who joined and can remove them.
- Not chosen: resolving the invitee's `oid` through Microsoft Graph when the invitation is made. It binds on an
  immutable ID, but needs a tenant-wide directory read permission and admin consent for the backend identity.

This is separate from finding 6: the legacy bind of a whole person record by email is removed.

**Review of the built code (22 October 2026)**

| #   | Finding                                                                                                                                    | Where                                                                            | Severity | Phase |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------- | ----- |
| 1   | Every backend route trusts an `x-user-id` header (a Joi string), so anything inside CDP can act as anyone, Platform Admin included         | backend `src/routes/*.js`                                                        | Critical | P1    |
| 2   | `POST /v1/users` is unauthenticated and upserts any `oid`, `tid` and email, which also binds pending team invitations by email             | backend `routes/users.js`, `services/user-service.js`                            | Critical | P1    |
| 3   | Team rights are checked four ways (`getMemberRole`, inline `teamMembers` reads, `credential.actorRole`), and no refused request is audited | backend `team-service.js`, `credential-service.js`, `team-deployment-removal.js` | Medium   | P1    |
| 4   | The CDP template's `/example` routes are still registered, unauthenticated                                                                 | backend `routes/example.js`, `plugins/router.js`                                 | Medium   | P1    |
| 5   | Eligibility is an email-domain allow-list, on a claim Microsoft says never to authorise on; nothing checks `tid` or guest status           | both, `allowedEmailDomains`                                                      | Medium   | P1    |
| 6   | A person record without `oid` is still bound by email at sign-in                                                                           | backend `user-service.js`, partial `{ oid, tid }` index                          | Low      | P1    |
| 7   | Audit records `actorUserId` only: no `tid`, `azp`, `uti` or role used                                                                      | backend `audit-service.js`                                                       | Low      | P1    |
| 8   | `PLATFORM_ADMIN_ROLE` is checked but nothing assigns it                                                                                    | backend `user-service.js`                                                        | Low      | P3    |
| 9   | The frontend authenticates to Entra with `AZURE_CLIENT_SECRET` in every environment                                                        | frontend `oidc-client.js`, `config.js`                                           | High     | P2    |
| 10  | The session ID is not renewed at sign-in (session fixation)                                                                                | frontend `routes/auth/controller.js`                                             | Medium   | P2    |
| 11  | No idle timeout; a session lasts a fixed 8 hours                                                                                           | frontend `config.js`, `plugins/session-cache.js`                                 | Medium   | P2    |
| 12  | Identity is passed by hand at about 45 call sites (`{ userId: sessionUser.id }`); one wrong argument changes who the backend acts for      | frontend routes                                                                  | Medium   | P2    |

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

**One place for each concern**

| Repository | Module                                      | Owns                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend   | `src/config/config.js`                      | `azureAd.authMethod` (`federated` or `client-secret`, as the backend's `armAuth.authMethod`), `azureAd.federatedAudience`, `azureAd.apiClientId`, `session.idleTimeoutMs`; refuses `client-secret` unless not production and `appBaseUrl` is on `localhost`                |
| Frontend   | `common/helpers/oidc-client.js`             | Discovery and the one client-authentication function: a `client_assertion` from `WebIdentityTokenProvider`, or `ClientSecretPost` on `localhost`; used for the code, refresh and client-credentials grants                                                                 |
| Frontend   | `common/helpers/access-token.js` (new)      | `getUserToken(request)` refreshes two minutes before expiry and ends the session on failure; `getAppToken()` caches the client-credentials token in memory until near expiry                                                                                               |
| Frontend   | `common/helpers/session.js`                 | Token storage beside the session user; the session is reset at sign-in and cleared at sign-out                                                                                                                                                                             |
| Frontend   | `common/helpers/api-client.js`              | The only way to call the backend: the user token when signed in, the app token otherwise; no `userId` option and no `x-user-id`; a 401 sends the person to sign in                                                                                                         |
| Frontend   | `plugins/require-sign-in-globally.js`       | The existing gate, plus the idle and absolute timeouts and `Cache-Control: no-store` on signed-in responses; a test pins the public routes (home, about, models, `GET /connect`, sign-in, sign-out, the auth callbacks, health), so a new public page is a reviewed change |
| Frontend   | `routes/auth/controller.js`                 | Scopes `openid profile email offline_access api://{api}/Portal.Access`; `PUT /v1/users/me` with the token and no body; maps a guest's 403 to the existing refusal page                                                                                                     |
| Backend    | `src/config.js`                             | `portalAuth.tenantId`, `portalAuth.audience` (the API's client ID), `portalAuth.clientId` (the frontend's), and `portalAuth.mockIssuerUrl`, refused in production                                                                                                          |
| Backend    | `src/plugins/auth.js` (new)                 | `@hapi/jwt` as `server.auth.default` with `access.scope: ['user']`: tenant JWKS, `RS256` only, `verify: { aud, iss, sub: false, nbf: true, exp: true, maxAgeSec: 7200, timeSkewSec: 60 }`; start-up fails if the keys cannot be fetched through the CDP proxy              |
| Backend    | `src/common/helpers/auth/identity.js` (new) | The `validate` function: `tid`, `ver`, `azp`, `azpacr`, `acct`, then `idtyp` with `scp`; one indexed read by `oid` and `tid`; credentials `{ userId, oid, tid, azp, uti, isPlatformAdmin, scope }` with `scope` `user` or `catalogue`                                      |
| Backend    | Route options                               | `auth.access.scope: ['user', 'catalogue']` on the two model reads only; `auth: false` on `/health` and the maintenance route only; everything else takes the default, as the route table above sets out                                                                    |
| Backend    | `routes/users.js`                           | `PUT /v1/users/me` upserts from token claims only, replacing `POST /v1/users`                                                                                                                                                                                              |
| Backend    | `src/common/helpers/auth/access.js` (new)   | The only rights checks: `requireTeamRole(db, actor, teamId, role)` (404 for a non-member, 403 `admin-required` for a member) and `requirePlatformAdmin(actor)`; records every refusal in the audit; a test fails if another module reads `teamMembers` for a role          |
| Backend    | Services and `audit-service.js`             | Services take `request.auth.credentials` as the actor; `recordAuditEvent` adds `tid`, `azp`, `uti` and the role used, and never a token                                                                                                                                    |

**Phases**

- **P0 Entra and CDP, by hand.** On the existing registration (now `app-aip-portal-dev`) add the federated credential,
  with issuer, subject and audience as design E `#cdp-trust` sets out, and the delegated permission `Portal.Access`.
  Create `api-aip-portal-dev`: identifier URI, v2 tokens, scope `Portal.Access`, the frontend pre-authorised, optional
  claims `acct`, `email` and `idtyp` (with `include_user_token`). Set `NODE_USE_ENV_PROXY=1` and the new variables for both
  services in CDP ([CDP proxy guide](https://github.com/DEFRA/cdp-documentation/blob/main/how-to/proxy.md)).
- **P1 Backend: the API enforces it.** Findings 1 to 7. Add `@hapi/jwt` and the backend modules above, give every route
  its access from the route table, and take the actor from `request.auth.credentials` in every service. Remove
  `x-user-id` from every route schema, `POST /v1/users`, the `/example` routes, `allowedEmailDomains` and the legacy
  person-record email bind (finding 6), with a dated backfill deleting person records without `oid`; invitation
  binding moves into `PUT /v1/users/me` as set out above. Tests: a helper mints tokens with a test RSA key and
  serves its JWKS through `nock`; one table-driven test sends every bad token in B27 to a protected route and expects
  401; `access.js` tests cover 404, 403 and the refusal audit; the route-table test above; route tests send a bearer
  token. Invitation tests:
  - an invitee's first sign-in joins the team once, with an audit record;
  - a second team's pending invitation for the same email binds to the same person;
  - a guest's or another tenant's token with the same email binds nothing;
  - a different `oid` with the same email after binding gets nothing;
  - a sign-in with no matching invitation changes no membership.

  Done when B27's acceptance criteria pass against the test keys.

- **P2 Frontend: the UI sends it.** Findings 9 to 12 through the frontend modules above; the call sites drop `userId`. The mock
  provider (`dev/mock-oidc-provider.js`) issues Entra-shaped JWT access tokens for the API (`oidc-provider`'s
  `resourceIndicators` with a default resource and `extraTokenClaims`), accepts the client-credentials grant, and the
  local backend trusts it through `portalAuth.mockIssuerUrl`.
- **P3 Deploy together.** Release P1 and P2 to CDP `dev` at once, so no backend ever accepts both a header and a token.
  Prove design E constraints 5 and 12, run the journey tests, then delete the client secret from the registration and
  from CDP. Set the first Platform Admin in the database by hand until the Platform Admin page exists (finding 8).
- **P4 Record.** Move this item to `implemented/06-shared-services-and-security.md` and update `implemented-features.md`,
  both repositories' `copilot-instructions.md` and READMEs (they still describe `x-user-id`), and
  discovery-docs `build-stories.md#status`.

Agreed on 22 October 2026: the first Platform Admin is set by hand; the maintenance route stays as built; a stolen
access token stays valid until it expires, accepted because tokens never leave the server-side session and CDP's
network is private; Terraform, other upgrades and sign-in policies such as MFA are out of scope.

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

## 4. Gateway authorisation layers (B23)

Design merged 19 Oct 2026 (discovery-docs #25). The global gateway guard with named backends merged in infra #16 (v0.8.0,
19 Oct). Read the infra code and the story, then record which of the other layers are built; do not infer it from the
design.

## 5. Research tier follow-ups

- **R8:** prompt [09-r8-tests-and-docs.prompt.md](../../.github/prompts/09-r8-tests-and-docs.prompt.md). A research-tier
  journey test against Infradev and a team-tier journey that asserts the placeholder wording (so it cannot outlive its
  reason); a security pass (no secret logged, `keyHint` everywhere but the two reveal points, subscription scoped to the
  research API, Joi rejecting unknown keys, the custom APIM role least privilege); and the discovery-docs record (section 9).
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

## 6. Quality and delivery

- **Phase 0:** restructure `build-stories.md` in discovery-docs so the story map carries a Status column and a dated build
  note, and delete the stale `#status` section. `Implemented` must be added to the closed status vocabulary in seven places
  (`scripts/manifest.js`, `src/content/overview.md`, `test/site.test.js`, `test/browser/review.spec.js` and others).
- **B01:** coverage thresholds in both `vitest.config.js` (95% statements, lines and functions, 90% branches; never lower),
  confirm the SonarCloud gate blocks, triage the checkov findings and remove the soft-fail, and remove the deprecated
  `azure` alias for `provisioning.mode`.
- **B02:** axe scan at WCAG 2.2 AA on every page a journey visits, one no-JavaScript journey per user-facing story
  (B06 to B10), `journey-` test data removed by a maintenance call. No journey run against an environment is recorded.
- **B14:** service-code verification is a mock only.

## 7. Platform operations

- **Dev proxy:** `cdp-tenant-config` #2024 allows the dev backend to download GitHub Actions artifacts
  (`.blob.core.windows.net`). Until it deploys, a team deployment stays on "Setting up access in Azure" after its apply has
  succeeded. After it deploys, the stuck deployment resolves on the next poll (or a Platform Admin runs
  `POST /v1/admin/team-deployments/{id}/reconcile`).
- **Terraform quality** (`ai-platform-infra` `docs/terraform-quality-plan.md`, review in infra #24): descriptions on about 40
  variables and 35 outputs, tests for 7 untested modules and the failing-case tests for 6 more, tflint `recommended`
  enforcement, pinned provider versions in module tests, a tested platform-to-tenants output contract, and relaxing the
  tenants `platform_release` precondition so the two can deploy independently (items Q1 to Q8, story B26).
- **Asynchronous operations** (story B28, plan in discovery-docs `docs/async-operations-plan.md`, decisions in D09 revised 25 Oct 2026): a worker service applies GitOps changes off the request path, with a backend outbox and events. Partly built on 28 and 29 Oct 2026 (infra `v0.10.0`, workflows `v2.0.0` to `v2.0.3`, worker `0.1.0`, backend `0.53.0`, frontend `0.60.0`, the `@v2` callers, CDP's grant to the events identity; see [05](implemented/05-platform-and-gitops-pipeline.md)). Left: the journey tests (journey tests #11) and the end-to-end check in Infradev; CDP's events role, not `sqs:SendMessage` only, was accepted on 29 Oct 2026.
- **Automate the GitOps message-schema re-sync** (worker and backend; origin: B28 CDP messaging change, 27 Oct 2026; owner: Platform Engineer for the workflows, Developer for the two repos' scripts; plan in discovery-docs `docs/async-operations-plan.md`, schemas in `ai-platform-infra` #31). `ai-platform-worker` and `ai-platform-backend-api` vendor `src/contracts/aip-gitops/` byte for byte from `ai-platform-infra/schemas/messages/` at the ref in `src/contracts/aip-gitops/VERSION`. `npm run contracts:sync -- {ref}` downloads at that ref; `npm run contracts:check` compares only with the pinned ref. Two gaps follow:
  1. After infra #31 is squash-merged, the pinned feature-branch SHA may stop resolving (404 in CI; unlikely, as GitHub usually keeps PR commits). Both repos then need a manual `contracts:sync -- {merged SHA}`.
  2. More important: a later infra schema change fails no CI in either repo, so the copies drift silently. A new field sent by the workflows is then rejected as invalid (the backend logs and acknowledges it, so the status update is lost; the worker dead-letters it) with CI green.

  Options, recommended A then B:
  - **A. Pin `VERSION` to an infra release tag** (release-please) instead of a SHA: removes the 404 risk; the bump is still by hand.
  - **B. Scheduled workflow in the worker and backend** that runs `contracts:sync` against infra's latest release tag or `main` and opens a PR when files differ: also detects drift. Needs pull-request permission and SHA-pinned actions.
  - **C. Infra opens PRs in the consumers** on a schema change: needs a cross-repo token or GitHub App.
  - **D. Publish the schemas as an npm package** with Dependabot: needs a registry and publish pipeline; the largest change.

  Done when a schema change in infra produces a sync PR in the worker and backend without manual work, and drift is visible.

- **Settings drift** (B28 follow-up, low priority; origin: review of 30 Oct 2026; owner: Platform Engineer; plan in
  discovery-docs `docs/async-operations-plan.md` section 15, mitigations 2 and 4). Workflows #20 (`v2.0.1`) stopped the
  apply preflight checking the bypass lists of `aip-machine-main` and `aip-machine-protect`, because GitHub returns
  `bypass_actors` only to a caller with write access to the ruleset
  ([rules API](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset)); the check moved to the daily
  `settings-drift.yml`, which has failed since 29 Oct 2026 because `AIP_SETTINGS_AUDIT_TOKEN` is not set. Keep #20.
  1. `scripts/setup/repo-settings.sh --verify` (`ai-platform-workflows`): `verify_ruleset` compares `bypass_actors` only
     when the live ruleset includes it, and `verify_no_person_bypass` warns instead of reading a missing list as `[]`;
     tests in `tests/integration/scripts/repo-settings.test.js`; correct the "read-only token" wording in
     `settings-drift.yml` and the README. A `fix:` patch to `v2`.
  2. Set `AIP_SETTINGS_AUDIT_TOKEN`: repository `Administration: read` and `Environments: read` on the two state
     repositories, and organisation audit-log read (organisation `Administration: read` or `read:audit_log`), which needs
     a Defra organisation owner. Fallback if refused: a dedicated audit App with repository `Administration: write`,
     used only by this scheduled run.
  3. Discovery-docs: section 15 mitigations 2 and 4 and a decision-history entry recording the #20 trade-off.

  Done when, with unchanged settings, the run passes with a warning per hidden list; a person, team or role in a visible
  bypass list fails it; and any `repository_ruleset.*` change in the last 26 hours fails it through `audit-log.sh`.

- **Promotion** (discovery-docs #27): two pins, pinned settings and pre-merge plans, so a release can reach an environment
  without lockstep.
- **Admin tasks:** the organisation Actions allow-list for the workflows the callers use; decide whether to turn off
  `autoPin` for Infradev; turn off `operator_state_access` once the pipeline is accepted.
- **Other environments:** CDP `infra-dev`, `test` and `prod` have no config for these services; the research tier is dev only
  so far.
- **Decommission:** the IaC checks handle `pending-removal`, `removed` and deletion with a cooling-off period, but a team has
  no portal path to it.

## 8. Housekeeping

- Rotate the old MongoDB password and GitHub PAT that sat in plaintext comments in a local backend `.env`.
- Open Dependabot pull requests: infra #9, workflows #2, frontend #36 to #42, backend #36 and #37, journey-tests #9 and #10.
- Finished one-shot prompts (R0 to R7, `01` to `08` in `.github/prompts/`) are kept for history; delete them when no longer wanted.

## 9. Record the built state in discovery-docs

`build-stories.md#status` was refreshed on 22 Oct 2026 (discovery-docs #31) for the portal stories, and again with this
table for B15 and B20 to B27. Still to read from the repositories: the infra and workflows rows (B15, B20 to B26; infra
v0.9.x), the real Azure note and gap 2 (is the research file applied?), the CDP dev rollout and the proxy finding. Use one
pull request that follows that repository's propagate, date and record rules, and report built state only from the
repositories, with the version and date.

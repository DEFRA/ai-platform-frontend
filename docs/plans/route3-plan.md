# Route 3: Team tier, joining a team that has access (B07 cont., B09 reuse, B10)

> Part of the ["three routes to a credential"](../ui-flow-three-routes.md) journey. See also [Route 0](route0-welcome-plan.md), [Route 1](route1-plan.md), [Route 2](route2-plan.md).
>
> **STATUS: IMPLEMENTED 25 Sept 2026**, built directly on Route 2's design-pack refactor (same day)
> rather than the original per-model credential shape - see notes below. Backend 92/92 tests pass,
> frontend 176/176 tests pass, both repos lint clean.

**UPDATED 25 Sept 2026 - discovery-docs design pack alignment:** before starting this plan, read
[Route 2's design pack alignment note](route2-plan.md#design-pack-alignment-25-sept-2026) and its
**Refactor plan** section in full - `ai-platform-discovery-docs` merged design pack content (23-25
Sept 2026) after Route 2 shipped that changes the shape this plan builds on:

- Route 2's Refactor plan moves team access from "one credential per team+model" to **one credential
  per team per environment** with a `gateway.allowedDeployments[]` list. If that refactor lands
  first (recommended), this plan's rotate/revoke operate on **one credential per team**, covering
  every model in that team's `allowedDeployments` at once - there is no per-model rotate. If it
  doesn't land first, this plan's Phase A/B steps below still work against today's per-model
  `credentials` rows, but every "rotate this credential" action then only affects one model, which
  will need redoing once Route 2's refactor lands.
- Credentials may now be `oauth`-typed as well as `subscription-key`-typed (design pack's
  `gateway.credentialType`, fixed per team per environment via `credential-type-fixed`). `rotate()`
  needs to produce a new value in whichever shape the team's existing credential uses - a new client
  secret for `oauth`, a new key for `subscription-key` - not assume the subscription-key shape.
- Admin-vs-user role enforcement (this plan's core new work) is unaffected by any of the above: the
  design pack doesn't change who may act, only what one credential covers and how it's typed.

Scope: third of three route plans (image 4 / build-stories B07 continuation + B09's reuse path +
B10). Depends on [Route 2's plan](route2-plan.md) being implemented first: reuses the real
"Your teams" section on `/manage` and the `/connect/team/model` flow it builds.

Aligned with design C (see
[design-orchestration.md](../../../ai-platform-discovery-docs/src/content/design-orchestration.md)
and Route 2's reworked plan): "reuse the credential" is precisely explained rather than just
observed. Route 2's `TenantOrchestrator` (GitOps-shaped) provisions team+model access ONCE; the
one shared team credential is auto-issued via the existing `CredentialIssuer` (Direct) the moment
that reaches `active`. By the time a second team member looks, both are already done - `GET
/v1/credentials` simply returns the existing credential, no request and no wait involved. This
plan does not change because of that - it confirms Phase C's "no new build" note was already
correct, just adds the causal explanation.

This is the smallest of the three plans - most of the surface (see what the team has, ask for
another model) already exists once Route 2 ships. The new work is: admin-vs-user role
enforcement, the rotate operation (distinct from renew), and the confirmation UI for both.

## Steps

Phase A - Backend: role enforcement and rotate operation (B10) _depends on Route 2 Phase A/B_

1. `ai-platform-backend-api/src/services/team-service.js` (from Route 2): add `getMemberRole(db, {teamId, userId})` helper returning `'admin' | 'user' | null` from `teamMembers`.
2. `ai-platform-backend-api/src/adapters/credential-issuer.js` / `mock-credential-issuer.js`: wire up the already-defined but no-op `rotate()` method - generate a new `mock-` secret and `keyHint`, same shape as `issue()`'s return (`{apimSubscriptionId, secret, keyHint, expiresAt}` - rotate keeps the existing `expiresAt`/policy, only the secret changes).
3. `ai-platform-backend-api/src/services/credential-service.js`: new `rotateCredential(db, locker, {id, userId})` - `requireLock` same pattern as `renewCredential`/`revokeCredential`; load the credential; if `credential.teamId` is set, require `getMemberRole(db, {teamId: credential.teamId, userId}) === 'admin'` else throw `403 admin-required` via `boomWithCode`; if the credential belongs to another team entirely (requester not a member at all), return `404` (do not `403`) so existence isn't disclosed - reuse the same not-a-member check pattern as `findTeamById`; call `issuer.rotate(...)`, update `keyHint`/`rotatedAt`, write an audit event via `recordAuditEvent` (actor, `teamId`, `credentialId`, outcome - never the secret).
4. `ai-platform-backend-api/src/services/credential-service.js`: extend `revokeCredential` (and `findCredentialForUser`/the `GET/DELETE /v1/credentials/{id}` routes) with the same admin-required check when `credential.teamId` is set - a `user`-role member can view but not revoke or rotate; research credentials (`teamId: null`) are unaffected, still self-service.
5. `ai-platform-backend-api/src/routes/credentials.js`: add `POST /v1/credentials/{id}/rotate` route (mirrors the existing `.../renew` route shape) calling `rotateCredential`.
6. Add integration tests: admin rotate succeeds and returns a new secret once; user-role POST to rotate/revoke on a team credential returns `403 admin-required`; another team's admin requesting a credential id they don't belong to returns `404`; audit events assert actor/team/credential id and never contain a secret.

Phase B - Frontend: role-aware manage page actions (B10) _depends on Phase A, Route 2 Phase E_ 7. `ai-platform-frontend/src/server/routes/manage/controller.js` (extended from Route 1/2): when rendering the "Your teams" section, look up the signed-in user's role for each team (via the team data already returned by `GET /v1/teams`/`GET /v1/teams/{id}`, or embed role in the `/v1/credentials` list response) and only render `Rotate`/`Revoke` buttons for `admin`; `user`-role members see the status/key hint only, no action buttons. 8. New `ai-platform-frontend/src/server/routes/manage/rotate.njk` + handler: `GET /manage/credentials/{id}/rotate` (confirmation page - warns that applications using the old secret will stop working), `POST /manage/credentials/{id}/rotate` (calls `POST /v1/credentials/{id}/rotate`, shows the new secret once, same one-render/no-cache treatment as the original issue page from Route 1). 9. Extend the existing `manage/revoke.njk` confirm flow (built in Route 1) to handle the `403 admin-required` `ApiError` from a crafted POST gracefully (safe error, not a stack trace) even though the button won't be rendered for non-admins. 10. Update `manage/controller.test.js`/`journey.test.js`: admin sees and can use rotate/revoke; a user-role member in the same team sees status only and a direct POST is refused with a safe error page.

Phase C - Verification of "reuse" and cross-team isolation (B09 reuse path, no new build) _depends on Phase B_ 11. No new frontend route: confirm the existing `/manage` team section (Route 2) already lets a member "reuse" a ready credential simply by viewing it there (no request needed) - add a journey test asserting a second team member signing in sees the same credential without creating a new one. 12. Add a cross-team isolation test (frontend journey + backend integration): Team B members cannot see or act on Team A's credentials via UI or API in either direction - covers `404` on foreign credential id and the team section only ever listing the signed-in user's own teams.

## Relevant files

- `ai-platform-backend-api/src/services/team-service.js` - `getMemberRole` helper
- `ai-platform-backend-api/src/adapters/mock-credential-issuer.js` - real `rotate()` behaviour
- `ai-platform-backend-api/src/services/credential-service.js` - `rotateCredential`, admin checks on rotate/revoke
- `ai-platform-backend-api/src/routes/credentials.js` - new `POST /v1/credentials/{id}/rotate`
- `ai-platform-frontend/src/server/routes/manage/` - role-aware rendering, new rotate confirm page

## Verification

1. Backend: `npm test` - rotate success/403/404 paths, revoke admin-required on team credentials, audit event assertions (no secret).
2. Frontend: `npm test` - manage page role-aware rendering, rotate confirm/action journey, crafted-POST refusal for non-admins.
3. Manual: as a team admin, rotate a credential and confirm the old secret is superseded; as a `user`-role member of the same team, confirm no rotate/revoke buttons appear and a direct POST is refused; as a different team's admin, confirm the credential id returns a 404 page.
4. `npm run lint` in both repos.

## Decisions

- Research (non-team) credentials keep self-service renew/revoke exactly as built in Route 1 - the admin-required rule only applies when `credential.teamId` is set.
- Rotation has no overlap/grace window in this slice (matches the diagram's own "no overlap period on rotation" - flagged as an open gap, not solved here); rotating immediately invalidates the old secret.
- Reissuing a credential after revoke is left as-is (whatever `/connect/team/model` already does from Route 2 - a fresh request) rather than building a distinct "reissue" action, since the diagram itself marks this as unresolved.

## Further considerations

1. No "leave the team" / offboarding route exists or is planned here (diagram explicitly marks this as not built) - flag if a fourth plan should scope it.
2. Where to source a member's role for `/manage` rendering (extend `GET /v1/credentials` response vs a separate `GET /v1/teams/{id}` lookup per team) - recommend embedding `role` directly on each team credential item returned by `GET /v1/credentials` to avoid N+1 calls from the frontend.

## Implementation notes (25 Sept 2026)

Built directly on top of Route 2's design-pack refactor (implemented the same day), which changed
the shape this plan targets - the "Depends on Route 2 Phase A/B" steps below were re-validated
against the refactored `team-deployment-service.js`/`credential-service.js`, not the original
per-model shape.

- **Rotate/revoke act on one credential per team per environment**, not per model - a team's
  `allowedDeployments` (however many models) share one secret, so rotating/revoking affects every
  model that credential covers at once. There is no per-model rotate, matching the design-pack
  reality that Route 2's refactor established.
- `team-service.js`: added `getMemberRole(db, {teamId, userId})`. Also extended `listTeamsForUser()`
  to embed each team's `role` for the caller directly in `GET /v1/teams` (the plan's own "Further
  considerations" #2 recommendation, adopted) - this is what `/manage` and the single-credential
  view page use to role-gate, with no extra per-team API call.
- `credential-issuer.js`/`mock-credential-issuer.js`: `rotate()` didn't already exist (the plan
  assumed a no-op stub that turned out not to be there) - added fresh, keyed off the credential's
  `apimSubscriptionId` prefix (`team-…` vs research) and `credentialType` to produce the right
  secret shape; `expiresAt`/policy are untouched by rotation, only `keyHint`/`rotatedAt` change.
- `credential-service.js`: added `loadCredentialForAction()` (role-aware, replaces the owner-only
  `findCredentialForUser` for rotate/revoke only - `renewCredential` stays owner-only/research-only,
  since team credentials don't renew as a concept) and `requireAdminForTeamCredential()`; both
  `rotateCredential` and `revokeCredential` now 404 for a non-member and 403 `admin-required` for a
  `user`-role member, exactly as specced. Added `POST /v1/credentials/{id}/rotate`.
- Frontend: `manage/controller.js` gained `isTeamAdmin()` (reads the `role` from `GET /v1/teams`),
  new `rotate`/`rotated` handlers and views (`manage/rotate.njk` confirm page, `manage/rotated.njk`
  one-time reveal with `cache-control: no-store`, mirroring the existing issue-page pattern), and
  the `revoke` POST handler now catches `403 admin-required` gracefully (notification + redirect,
  not a crash) even though the button is never rendered for a non-admin. `credential-actions`
  component gained a `showRotateRevoke`-gated Rotate button alongside Revoke (View is unconditional).
- `manage/credential.njk` (the persistent detail page) and `manage/revoke.njk`/`rotate.njk` now
  support a credential covering several models (`allowedDeployments`) - a small models list/joined
  names instead of one singular `model`, since that's what Route 2's refactor changed the shape to.
- Phase C (reuse/cross-team isolation verification) - covered by existing Route 2 tests plus new
  cross-team-admin-404 and non-member-404 rotate/revoke tests; no new build was needed, confirming
  the plan's own prediction.

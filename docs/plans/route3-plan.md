# Route 3: Team tier, joining a team that has access (B07 cont., B09 reuse, B10)

> Part of the ["three routes to a credential"](../ui-flow-three-routes.md) journey. See also [Route 0](route0-welcome-plan.md), [Route 1](route1-plan.md), [Route 2](route2-plan.md). **Status: not yet implemented** — re-validate against the current `team-service.js` shape before starting (see Route 2's follow-up note; `teamMembers.userId` can be `null` for not-yet-bound invited members).

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

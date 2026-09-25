# Route 2: Team tier, the first person in a team (B08, B09)

> Part of the ["three routes to a credential"](../ui-flow-three-routes.md) journey. See also [Route 0](route0-welcome-plan.md), [Route 1](route1-plan.md), [Route 3](route3-plan.md).
>
> **STATUS: IMPLEMENTED 23 Sept 2026.** Backend 68/68 tests pass, frontend 136/136 tests pass, both
> repos lint clean. `npm run format:check` fails in both repos on the same pre-existing, repo-wide
> baseline noted in Route 1's plan (65/118 files, essentially the whole tree) - not caused by this
> work, left alone.

## Design pack alignment (25 Sept 2026)

`ai-platform-discovery-docs` merged a design pack after this route shipped (21-25 Sept 2026):
[design-orchestration.md#model-access](../../../ai-platform-discovery-docs/src/content/design-orchestration.md)
("Model access enforcement", area C, 23 Sept), [design-environments.md#phase-1](../../../ai-platform-discovery-docs/src/content/design-environments.md)
(the Phase 1 SND1/SND4 proof, 24-25 Sept) and [design-repositories-pipelines.md](../../../ai-platform-discovery-docs/src/content/design-repositories-pipelines.md).
Unlike Route 1, this is **not** a documentation-only reconciliation - the design pack fixes several
things this route built ahead of the design, in a materially different shape. Flagged here for the
refactor that follows this file's update (see chat/PR description); nothing in this section has been
built yet.

1. **One credential per team per environment, not one per team+model.** [Model access
   enforcement](../../../ai-platform-discovery-docs/src/content/design-orchestration.md) is explicit: a team gets a single API at path
   `/{team}` in each environment, gated by one `gateway.credentialType` and one
   `gateway.allowedDeployments[]` allow-list; requesting a second dedicated model for a team already
   using the platform **adds an entry to that same allow-list**, it does not mint a second
   credential. This codebase instead creates an independent `teamDeployments` row and an independent
   `credentials` row (`tier: 'team'`) per `{teamId, modelSlug, environment}` - there is no concept of
   a single team-wide credential or an allow-list anywhere in `team-deployment-service.js` or
   `credential-service.js`.
2. **Credential type is fixed and typed, and can be OAuth.** `gateway.credentialType` is `oauth`
   (an Entra client-credentials token bound to a team application registration with the
   `Model.Invoke` app role) or `subscription-key`, chosen once per team per environment - changing it
   is a team-file edit that regenerates the API, and the design pack names a stable
   `credential-type-fixed` error code for rejecting a switch. `mock-credential-issuer.js` and
   `mock-tenant-orchestrator.js` only ever produce one generic `type: 'apim-subscription'` shape with
   a `mock-` secret; there is no `oauth` credential path, no team application/service-principal
   concept, and no fixed-type-per-team enforcement.
3. **New stable code `model-not-granted`.** The gateway's per-request 403 when a deployment isn't in
   the caller's `allowedDeployments[]` is `model-not-granted` - distinct from the already-implemented
   catalogue-level `model-not-eligible` (checked once, before a deployment is even requested) and
   from `deployment-not-ready` (this codebase's stand-in for "the team's stack hasn't reached
   `active` yet", which the design pack doesn't name as a stable code but is a reasonable interim
   state on the way to `active`).
4. **Real desired-state shape.** The team's actual state document
   (`environments/{env}/{team}.json` in `ai-platform-tenants`) is `project.name`, `deployments[]`,
   `gateway.{credentialType, allowedDeployments[], limits}` and `oauthClient.{enabled, appRoles[]}`.
   `teamDeployments` (this codebase's Mongo collection) is a reasonable mirror of `deployments[]`
   alone; it has no sibling `gateway`/`oauthClient` state, which is what needs to exist for point 1
   above to be buildable.
5. **Environment naming.** The design pack's Phase 1 (confirmed 24 Sept 2026 by the senior
   stakeholder) runs the real MVP against `infradev` (`SND1`) and `sandbox` (`SND4`) - not a literal
   `dev` environment. `team-deployment-service.js`'s `if (environment !== 'dev')` policy gate and the
   Joi `.valid('dev', 'qa', 'preprod', 'prod', 'uat')` enum in both `credentials.js` and
   `team-deployments.js` neither allow `infradev`/`sandbox` nor match the one environment Phase 1
   actually runs in.
6. **Tier naming.** The design pack's catalogue schema uses `tiers: ['research', 'dedicated']`; this
   codebase persists `tier: 'team'` on credentials and `tiers: ['research', 'team']` in
   `models.seed.json`. Likely fine as a portal-facing rename only ("Team tier" UI copy stays), but
   worth a deliberate decision rather than silent drift if/when a real catalogue import lands.

See the end of this file for the specific refactor steps this implies.

## Files created/changed

- Backend Phase A: `src/services/team-service.js`, `src/routes/teams.js` + `.test.js` (new); updated
  `src/plugins/router.js` (register teams), `src/plugins/mongodb.js` (teamMembers indexes),
  `src/services/user-service.js` (bind invited members by email on `upsertUser`).
- Backend Phase B: `src/adapters/tenant-orchestrator.js` (port), `mock-tenant-orchestrator.js`,
  `src/services/team-deployment-service.js`, `src/routes/team-deployments.js` + `.test.js` (new);
  updated `src/services/credential-service.js` (tier:'team' branch + `listCredentials` union),
  `src/routes/credentials.js` (Joi tier/teamId/environment), `src/plugins/mongodb.js`
  (teamDeployments unique index on `{teamId, modelSlug, environment}`), `src/config.js`
  (`teamDeployment.mockStageDurationMs`), `src/common/seed/models.seed.json` (gpt-4o now carries
  `tiers:['research','team']` + `environments:['dev']`), `src/routes/teams.test.js` and
  `src/routes/credentials.test.js` additions (team-tier issuance/reuse/404/409 scenarios).
- Frontend Phase C: `connect/controller.js` accessTypeSchema now allows `'shared'|'team'`, routes
  team to `/connect/team/select`; new `connect/team-controller.js` (kept separate from
  `controller.js` for single responsibility - selectTeam, selectModel, details, check, request/{id},
  credential); new `session.js` helpers `getPendingTeam`/`setPendingTeam`/`clearPendingTeam`; new
  `teams/` route plugin (list, new -> new/check -> `POST /v1/teams`, `{id}` member list +
  admin-only add-member form, `?returnTo=` round-trip back into the connect flow).
- Frontend Phase D: `connect/team/*.njk` views (select, details, check, request - the wait page with
  `<meta http-equiv="refresh">`); reuses `connect/shared/model.njk` and
  `connect/shared/credential.njk` directly (identical shape, avoids duplicating a template).
- Frontend Phase E: `manage/controller.js` + `index.njk` real "Your teams" section - fetches
  `GET /v1/teams` alongside the existing `GET /v1/credentials`/model-name map calls (now 3 parallel
  API calls instead of 2 - every `/manage` test needed a third mocked response added), groups
  credentials by `teamId`, one read-only sub-section per team - no renew/revoke/rotate (Route 3's
  scope). Added `statusCodes.conflict = 409` to the frontend's shared status-codes constant.

## Design decisions/deviations (all documented, none functional gaps)

- Did NOT add a `PROVISIONING_MODE` mock/real config toggle for `TenantOrchestrator` - the existing
  `CredentialIssuer` has no such toggle either (just a default parameter
  `issuer = mockCredentialIssuer`), so `mock-tenant-orchestrator.js` is wired the same way
  (`orchestrator = mockTenantOrchestrator` default param) for consistency. No real adapter exists
  yet either way.
- Extended `boomWithCode(boomFactory, message, code, extra = {})` to accept an `extra` object (e.g.
  `{ existingId }`) and extended `server.js`'s `onPreResponse` to `Object.assign` all of
  `response.data` into the error payload (previously only `code` was exposed) - needed so the 409
  deployment-exists response could carry an `existingId` link. Frontend's `ApiError` (api-client.js)
  correspondingly spreads extra backend body fields onto the thrown error instance.
- team-tier credential issuance: `findActiveDeployment` gates issuance (409 'deployment-not-ready'
  if not active yet); if a team already has an active credential for that model, a new request just
  returns the existing one as `replay: true` (shared reuse, not an error) - covers Route 3's "reuse"
  case for any team member, not just the second one.
- `teamDeployments` status only advances when polled (`GET .../deployments/{id}` calls
  `getDeploymentStatus` and persists the result) - no background timer/interval anywhere.
- Mock orchestrator failure simulation: reserved `requestedBy` (userId) prefixes
  `test-checks-fail-` / `test-deploy-fail-`, tracked in an in-process Map keyed by `operationId` (set
  in `requestDeployment`, read in `getDeploymentStatus`) - mirrors mock-credential-issuer's
  `test-fail-` prefix pattern.

**Follow-up for Route 3:** re-validate [route3-plan.md](route3-plan.md) against the current
`team-service.js` shape before starting - some details (e.g. a `getMemberRole` helper) assume a
shape that may differ slightly now (e.g. `teamMembers.userId` can be `null` for not-yet-bound
invited members).

**UX follow-up fix (23 Sept 2026):** the original wait page (`/connect/team/request/{id}`) was
session-only - it depended on `pendingAccess` to know which team/model/environment to poll, so
navigating away (closing the tab, losing the session) made the in-progress request unreachable, and
`/manage` never linked to it. Fixed:

- Backend: added `listDeploymentsForTeam` + `GET /v1/teams/{teamId}/deployments` (list, not just by
  id) so `/manage` can show every in-progress/failed/unrevealed deployment per team.
- Frontend: route is now `/connect/team/request/{teamId}/{id}` (URL-driven, no session dependency -
  derives `modelSlug`/`environment` from the deployment record itself, so it's a stable, bookmarkable
  link). Wait page shows friendly 3-stage progress (`Reviewing your request` -> `Setting up your
team's dedicated model` -> `Running final checks`) instead of one flat message, plus a permanent
  link to `/manage`. `/manage`'s team section now has a "Requests" sub-list with "Check progress" /
  "Setup failed" / "Ready to view" rows and links back into the (now-stable) wait page URL for any
  deployment that hasn't yet produced a viewed credential. If a teammate visits an already-revealed
  credential's wait page, they're redirected to `/manage` with a banner instead of erroring (the
  secret was already shown once to the original requester). Backend 71/71 tests pass, frontend
  139/141 (2 pre-existing environmental flakes unrelated to this change - port-3000-in-use from a
  stray dev server, and a sign-in timeout under system load - both confirmed to pass in isolation).

**UI follow-up (23 Sept 2026):** `/manage` redesigned to use GOV.UK tables (rows) instead of
stacked cards for both "Your credentials" and each team's credentials/requests, and each credential
row now has a "View" link to a new persistent detail page (`GET /manage/credentials/{id}` ->
`manage/credential.njk`, no secret - it was already shown once at issuance). Backend: added
`findCredentialForViewing` (team-aware read, mirrors `listCredentials`' access rule) and wired it
into the GET-by-id route only - renew/revoke still use the stricter owner-only
`findCredentialForUser` unchanged, since team-credential rotate/revoke role enforcement is still
Route 3's job. Backend 72/72, frontend 140/141 (same pre-existing EADDRINUSE flake, unrelated).

Scope: second of three route plans (image 3 / build-stories B08 + B09). Depends on Route 1's plan
([route1-plan.md](route1-plan.md)) being implemented first: reuses `/connect`'s access-type
chooser (enables the "Dedicated model for your team" radio), reuses `/manage` (adds the real
"Your teams" section that Route 1 leaves as a placeholder).

**REWORKED 21 Sept 2026** to align with design C ("self-service orchestration", `ai-platform-discovery-docs`
PR #6 - see [design-orchestration.md](../../../ai-platform-discovery-docs/src/content/design-orchestration.md)
for the full detail). The old approach (a single mocked `CredentialIssuer.issue()` call held
`pending` for a delay) was DISCARDED. Design C makes clear that "connect to a dedicated team model"
is two distinct backend concepts, and the route plan follows that split:

- **Phase 1, GitOps-shaped (new, once per team+model+environment):** provisioning the team's
  access to the model itself - modelled by a new mocked `TenantOrchestrator` port using design C's
  real operation state names. This is the slow part with the "being set up" wait page.
- **Phase 2, Direct (reuses the existing `CredentialIssuer` from Route 1, unchanged):** once Phase
  1 reaches `active`, the backend auto-issues ONE team credential (shared across the team, not
  per-member - matching the existing "one credential doc per team+model" design, which needed no
  change). This is fast/synchronous, exactly like research tier issuance.

This split also explains Route 3's "reuse the credential" needing no request and no wait: by the
time a second member looks, Phase 1 is already `active` for that team+model, so `GET /v1/credentials`
already shows it.

Per the AICE `javascript-design-language` skill (`.github/skills/` in the frontend repo, see Route
1's plan): `/teams`, `/teams/new`, `/teams/{id}` and `/connect/team/*` follow the same **form
journey / content page** patterns as Route 1's `/connect/shared/*` and `/models` - question pages
for single-input steps, the panel pattern for `/connect/team/credential` once `active`,
content-page (two-thirds) for `/teams/{id}`'s member list.

Not in scope here: rotate/revoke and admin-vs-user role enforcement on `/manage` - that is
Route 3's plan (B10), even though team creation makes the creator an admin.

**VALIDATED 23 Sept 2026 against current codebase before implementation** - Route 1 confirmed
IMPLEMENTED (dependency satisfied). Findings and decisions locked with user:

- **Gap found & resolved:** `credential-service.js` currently derives `teamId` via
  `findTeamIdForUser(db, userId)` reading a single `teamId` field on the `users` doc - incompatible
  with the new many-to-many `teamMembers` model. Decision: the frontend passes `teamId` explicitly
  on every team-tier request (`POST /v1/teams/{teamId}/deployments` and the team-tier
  `POST /v1/credentials` payload both carry `teamId`) rather than deriving it from the user doc.
  `findTeamIdForUser`/`users.teamId` becomes dead code for the team path (leave for research tier,
  which stays `teamId: null`).
- **Gap found & resolved:** no team-tier model existed in seed data yet (`models.seed.json` only had
  `tiers: ["research"]`, no `environment(s)` field anywhere). Added a step to seed at least one model
  with `tiers` including `'team'` and an `environments: ['dev']` field.
- Step 6's "reuse the existing provisioning mode toggle" parenthetical was moot - confirmed no such
  config existed yet (`src/config.js` had no `PROVISIONING_MODE`-style key) - a fresh one was added.
- `serviceCode` validation locked to loose free text, no regex (`Joi.string().max(20).optional()`
  or similar) - matches the "never verified" decision.
- Naming locked: `teamDeployments` collection, nested route `/v1/teams/{teamId}/deployments` (not
  `dedicatedDeployments`/top-level `/v1/deployments`).
- Auto-issue vs explicit second call locked to **explicit call**: the polling wait page, on
  observing `status: active`, itself triggers `POST /v1/credentials` for the team+model before
  rendering the credential - no backend auto-issue timer needed. The existing no-JS
  `<meta http-equiv="refresh">` polling loop satisfies "keep polling" through every intermediate
  GitOps state and this final step alike.

## Steps

Phase A - Backend: teams data model and CRUD (B08) - unchanged from the original plan

1. New `ai-platform-backend-api/src/services/team-service.js`: `createTeam(db, {name, serviceCode, description, createdBy, idempotencyKey})` - normalise name (`toLowerCase().trim().replace(/\s+/g,'-')`) same pattern as the team-by-name upsert removed from `user-service.js` in Route 1; check for an existing team by `createdBy` + `idempotencyKey` first (idempotent replay, same pattern as `issueCredential` in `src/services/credential-service.js`); insert team then insert the creator into `teamMembers` with `role: 'admin'`, `status: 'active'`. Throw `409 team-exists` via `boomWithCode(Boom.conflict, ..., 'team-exists')` on duplicate `normalisedName`.
2. `listTeamsForUser(db, userId)`, `findTeamById(db, {id, userId})` (404 via `boomWithCode`/`Boom.notFound` if requester has no `teamMembers` row for that team - do not leak existence), `addMember(db, {teamId, actorUserId, email})` (403 `admin-required` if actor's `teamMembers` role isn't `admin`; inserts invited row `{teamId, email, role: 'user', status: 'invited'}`).
3. New `ai-platform-backend-api/src/routes/teams.js`: `GET /v1/teams` (list for `x-user-id`), `POST /v1/teams` (Joi: `name` 3-60 chars, optional `serviceCode` as loose free text, optional `description`; requires `idempotency-key` header like `POST /v1/credentials`), `GET /v1/teams/{id}`, `POST /v1/teams/{id}/members` (Joi: `email`).
4. `ai-platform-backend-api/src/plugins/mongodb.js`: add indexes - `teamMembers` compound `{teamId:1, userId:1}` and `{email:1}` (for invite binding lookup); the existing unique `teams.normalisedName` index already covers B08's duplicate-name rule.
5. `ai-platform-backend-api/src/services/user-service.js`: on `upsertUser`, after the user upsert, bind any `teamMembers` rows with matching `email` and `status: 'invited'` to the signed-in user (`$set: { userId, status: 'active' }`) - this is how an invited member's membership activates on first sign-in (per B08's "bound on first sign-in").

Phase B - Backend: `TenantOrchestrator` port + team deployment provisioning (B09, REWORKED) _depends on Phase A_ 6. New `ai-platform-backend-api/src/adapters/tenant-orchestrator.js`: port typedef with `requestDeployment({teamId, modelSlug, environment, operationId})` -> the real GitOps commit/PR/deploy-workflow chain, one call, async result delivered by polling; and `getDeploymentStatus({operationId})`. Mirrors the shape of `credential-issuer.js` (JSDoc port + a `mock-tenant-orchestrator.js` adapter), selected by a new `PROVISIONING_MODE`-style config key added to `src/config.js`. 7. New `ai-platform-backend-api/src/adapters/mock-tenant-orchestrator.js`: on `requestDeployment`, inserts a record and schedules it to advance through design C's real states on a configurable timer: `requested` -> `pr-raised` -> `merged` -> `deploying` -> `deployed` -> `verified` -> `active` (happy path), with a configurable chance/trigger to land on `checks-failed` or `deploy-failed` instead (terminal, for testing the failure UI) via the same reserved-test-pattern approach as Route 1's mock issuer failure simulation. 8. New collection `teamDeployments`: `{_id, teamId, modelSlug, environment, status, operationId, requestedBy, createdAt, activatedAt, failureReason}`. Unique index on `{teamId, modelSlug, environment}` - one deployment record per team+model+environment ever; a second request while `requested`..`verified` or `active` returns `409` with a link to the existing one (matches B09's acceptance criteria).
9a. `ai-platform-backend-api/src/common/seed/models.seed.json`: add (or extend an existing entry with) at least one model carrying `tiers: ['team']` (or `['research', 'team']`) and a new `environments: ['dev']` field, so Phase B/C/D eligibility checks and the frontend model-select step have a real team-tier model to select. 9. New `ai-platform-backend-api/src/services/team-deployment-service.js`: `requestDeployment(db, {teamId, modelSlug, environment, requestedBy}, orchestrator)` - verify requester is a `teamMembers` row for `teamId` (404 if not), model carries the `team` tier and lists `environment` (403 `model-not-eligible` otherwise), no existing non-terminal/`active` record for `{teamId, modelSlug, environment}` (409), then insert `requested` and call `orchestrator.requestDeployment(...)`. `getDeployment(db, {id, teamId})`, `findActiveDeployment(db, {teamId, modelSlug, environment})`. 10. New `ai-platform-backend-api/src/routes/team-deployments.js` (or nest under `teams.js`): `POST /v1/teams/{teamId}/deployments` (payload: `modelSlug`, `environment`), `GET /v1/teams/{teamId}/deployments/{id}` (for the "being set up" poll). 11. `ai-platform-backend-api/src/services/credential-service.js`: extend `issueCredential` so a `tier: 'team'` request carries an explicit `teamId` in the payload (do NOT derive it from `users.teamId`/`findTeamIdForUser` - that single-team field is incompatible with the new many-to-many `teamMembers` model; leave `findTeamIdForUser` in place only for research tier, or remove if unused). Instead of holding `pending` itself, first checks `findActiveDeployment(db, {teamId, modelSlug, environment})` is `active` (`409`/link if not - "deployment not ready yet") - if active, proceed **synchronously** exactly like research tier (same `issuer.issue()` mock, instant). 12. **Locked decision: explicit second call, not auto-issue.** The mock orchestrator's `active` transition (item 7) does NOT call `issueCredential` itself. Instead, the frontend's polling wait page (step 22), on observing `status: active` from `GET /v1/teams/{teamId}/deployments/{id}`, makes one `POST /v1/credentials` call (with `tier: 'team'`, `teamId`, `modelSlug`) before rendering the credential. 13. `ai-platform-backend-api/src/services/credential-service.js`: extend `listCredentials(db, {userId})` to also return credentials where `teamId` is one of the user's `teamMembers` team ids (union with the existing own-`userId` query) - needed for `/manage`'s real "Your teams" section (item 24 below). 14. Introduce the `environment` field's Joi enum wherever it's newly added (`teamDeployments`, `POST /v1/credentials` team-tier payload) as `dev|qa|preprod|prod|uat` per design C, but validate/allow only `'dev'` in this slice (reject others with a clear `environment-not-available` 403 or similar) - future environments become a policy change, not a schema change.

Phase C - Frontend: team select/create (B08) - unchanged from the original plan _depends on Phase A, parallel with Phase B_ 15. `ai-platform-frontend/src/server/routes/connect/index.js` (built in Route 1): enable the previously-disabled "Dedicated model for your team" radio; selecting it routes to `/connect/team/select`. 16. New `ai-platform-frontend/src/server/routes/connect/team/select.njk` + handler: `GET/POST /connect/team/select` - lists the user's teams (`GET /v1/teams`) as radios plus a "Create a new team" link; if none, goes straight to create. 17. New `ai-platform-frontend/src/server/routes/teams/`: `index.js`, `controller.js`, views for `GET /teams` (list, reachable directly too), `GET/POST /teams/new` (name/serviceCode/description form -> check-answers -> `POST /v1/teams` with a generated `Idempotency-Key`, same pattern as `api-client.js` credential calls), `GET /teams/{id}` (members list; admins see an "Add a member" form posting to `POST /v1/teams/{id}/members`; non-admins see view-only). 18. Register the new `teams` plugin in `ai-platform-frontend/src/server/plugins/router.js`.

Phase D - Frontend: connect to a dedicated team model, GitOps-shaped wait page (B09, REWORKED) _depends on Phase B, C_ 19. New `ai-platform-frontend/src/server/routes/connect/team/model.njk`+handler: `GET/POST /connect/team/model` - models carrying the `team` tier and listing environment `dev` (mirrors Route 1's `/connect/shared/model` pattern). 20. New `.../connect/team/details.njk` - purpose textarea + environment field (`dev` pre-selected/only option, disabled others with hint per B09). 21. New `.../connect/team/check.njk` - check-your-answers, generates `Idempotency-Key`, posts `{modelSlug, teamId, environment}` to the new `POST /v1/teams/{teamId}/deployments` (NOT `/v1/credentials` directly - that's the change from the old plan). 22. New `.../connect/team/request.njk`+handler: `GET /connect/team/request/{teamId}/{id}` - polls `GET /v1/teams/{teamId}/deployments/{id}` via a `<meta http-equiv="refresh">` (no JavaScript, per B09); shows a friendly status while `status` is any of `requested`/`pr-raised`/`merged`/`deploying`/`deployed`/`verified` (group these as one user-facing "being set up" message); once the deployment is `active`, issue/reuse the team credential and redirect to `/connect/team/credential` (secret shown once, to the requester only - non-requesters are sent to `/manage`); shows a safe error if `checks-failed`/`deploy-failed`. 23. Handle `409` (existing non-terminal/active deployment for this team+model -> link to the existing request/credential page) and `404` (not a team member) `ApiError` codes from `api-client.js` in the check/request controllers.

Phase E - Frontend: real "Your teams" section on /manage (B09's manage-page requirement) _depends on Phase B item 13, D_ 24. `ai-platform-frontend/src/server/routes/manage/` (renamed in Route 1): replace the placeholder "Your teams" block with a real listing - one sub-section per team, each credential showing model, status tag, key hint, issued/expiry, **no** renew/revoke/rotate actions yet (that's Route 3/B10) - read-only for now, listing every member's shared team credential per B09's "shows on `/manage` under the team for all members". 25. Update `manage/controller.test.js`/`journey.test.js` to cover the new team section.

## Relevant files

- `ai-platform-backend-api/src/services/team-service.js` (new), `src/routes/teams.js` (new)
- `ai-platform-backend-api/src/adapters/tenant-orchestrator.js`, `mock-tenant-orchestrator.js` (new)
- `ai-platform-backend-api/src/services/team-deployment-service.js` (new), `src/routes/team-deployments.js` (new)
- `ai-platform-backend-api/src/services/user-service.js` - bind invited members on sign-in
- `ai-platform-backend-api/src/services/credential-service.js` - team-tier branch checks `findActiveDeployment` instead of holding pending itself; extend `listCredentials`
- `ai-platform-backend-api/src/plugins/mongodb.js` - new `teamMembers` and `teamDeployments` indexes
- `ai-platform-frontend/src/server/routes/connect/index.js` - enable team radio
- `ai-platform-frontend/src/server/routes/connect/team/` (new) - select, model, details, check, request/{id}
- `ai-platform-frontend/src/server/routes/teams/` (new)
- `ai-platform-frontend/src/server/routes/manage/` - real team section
- `ai-platform-frontend/src/server/plugins/router.js` - register `teams`

## Verification

1. Backend: new unit/integration tests for `team-service.js`, `teams.js` routes (409 team-exists, 403 admin-required, 404 not-a-member), `team-deployment-service.js` (state progression, 409 duplicate, `checks-failed`/`deploy-failed` terminal states), team-tier branch of `issueCredential` (only proceeds once deployment `active`), extended `listCredentials`.
2. Frontend: controller/journey tests for team select/create, connect/team/* flow including the "being set up" page without JavaScript across the grouped GitOps states, and the new `/manage` team section.
3. Manual: sign in -> `/connect` -> dedicated team radio -> create a team -> choose a model -> details -> check answers -> "being set up" page auto-refreshes through the GitOps states -> becomes credential page -> `/manage` shows it under the team.
4. `npm test`, `npm run lint` in both repos.

## Decisions

- Team creator becomes the team's first admin (per B08's stated interim rule) - not re-litigated here.
- Billing/service code verification is out of scope (captured, stored `unverified`, never verified) - matches B08 explicitly.
- Invited membership is by Defra email match at next sign-in (no Entra group lookup) - matches current email-based identity model post Route-1 changes.
- `/manage` team section built here is read-only; rotate/revoke/admin-role enforcement is Route 3's plan.
- **Two-phase model adopted from design C:** `TenantOrchestrator` (new, mocked) provisions team+model access with real GitOps state names; `CredentialIssuer` (existing, unchanged) issues the one shared team credential once that's `active` - discards the earlier single-port "hold pending" approach entirely.
- `environment` enum introduced fresh (no pre-existing enum to widen) at all five design-C values; only `dev` is policy-allowed in this slice.
- **Locked 23 Sept 2026:** team-tier requests pass `teamId` explicitly (frontend knows it from the `/connect/team/*` flow) rather than deriving it from `users.teamId`/`findTeamIdForUser`.
- **Locked 23 Sept 2026:** credential issuance on deployment activation is an explicit second call (the wait page's poll handler calls `POST /v1/credentials` once it sees `active`), not a backend auto-issue timer.
- **Locked 23 Sept 2026:** collection/route naming is `teamDeployments` / `/v1/teams/{teamId}/deployments` (not `dedicatedDeployments`/top-level `/v1/deployments`).
- **Locked 23 Sept 2026:** `serviceCode` is loose free text with no regex pattern (matches "never verified" decision).

## Further considerations

1. Nobody notifies an invited member today (flagged as an open gap on the diagram itself) - out of scope unless a notification step is added.
2. No route lets the requester hand the secret to teammates after issue (also flagged as open on the diagram) - out of scope for this plan.

## Refactor plan (not yet started) - design pack alignment

Concrete follow-up for the six gaps in [Design pack alignment](#design-pack-alignment-25-sept-2026)
above. Sequenced so the data-model change lands before anything reads it differently; each phase
should keep its own `npm test`/`npm run lint` green before moving on, per this repo's quality gates.

1. **Backend - reshape team access state.** In `team-deployment-service.js`/`teamDeployments`: keep
   one document per `{teamId, environment}` (drop `modelSlug` from the unique key) carrying
   `deployments: [{modelSlug, status, ...}]` (today's per-model progression, now nested) plus new
   `gateway: {credentialType, allowedDeployments: [], limits}` and `oauthClient: {enabled,
   appRoles: []}` siblings, mirroring the design pack's `environments/{env}/{team}.json` shape.
   Requesting a second dedicated model for a team that already has a document for that environment
   appends to `deployments[]`/`allowedDeployments[]` instead of inserting a new document - the unique
   index and 409 `deployment-exists` semantics move from "per model" to "per model within the
   document", i.e. a 409 only when that specific `modelSlug` is already present.
2. **Backend - one credential per team per environment.** In `credential-service.js`'s `tier ===
   'team'` branch: stop keying `credentials` by `{teamId, modelSlug, tier: 'team', status:
   'active'}`; key by `{teamId, environment, tier: 'team', status: 'active'}` instead, so a second
   dedicated model reuses the team's existing credential row (extending its `allowedDeployments`
   mirror) rather than creating a sibling row. `findActiveDeployment` becomes "is this modelSlug
   present and `active` inside the team's environment document" per point 1.
3. **Backend - typed, fixed credentials.** Extend the `CredentialIssuer`/`TenantOrchestrator` mock
   adapters to accept `credentialType: 'oauth' | 'subscription-key'` and return a shape that
   distinguishes them (an opaque `mock-oauth-` vs `mock-key-` prefix is enough for a mock); persist
   `credentialType` on the team's environment document at first issuance and reject a later request
   that asks for a different type with a new `boomWithCode(Boom.conflict, ..., 'credential-type-fixed')`.
   `oauth`-typed teams don't get a `keyHint`/secret in the same shape as a subscription key - the
   frontend `/connect/team/credential` and `/manage` views need a second rendering branch for it.
4. **Backend - adopt `model-not-granted`.** Where the gateway allow-list check would live (today
   nowhere - there's no runtime gateway simulation), reserve the code `model-not-granted` rather than
   reusing `model-not-eligible`/`deployment-not-ready` for it, so a future gateway mock or real
   adapter can throw it without a rename. No route changes needed until that gateway simulation is
   built; this is a "don't collide names later" note, not an immediate code change.
5. **Backend - environment naming.** Change the Joi enum in `credentials.js`/`team-deployments.js`
   from `.valid('dev', 'qa', 'preprod', 'prod', 'uat')` to the Phase 1 set (`.valid('infradev',
   'sandbox')`, widened later as consumer environments are added per the registry), and change
   `team-deployment-service.js`'s policy gate from `environment !== 'dev'` to allow `'sandbox'` (the
   live Phase 1 environment; `'infradev'` is platform-internal/synthetic, not team-facing) - confirm
   the exact allowed value(s) with the team before changing, since this is a product/config decision,
   not a pure refactor.
6. **Frontend - follow the backend shape.** `connect/team-controller.js`'s check/request/credential
   steps and `manage/controller.js`'s team section need to read `gateway.allowedDeployments`/
   `deployments[]` instead of one `teamDeployments` row per model, and render the oauth-vs-key
   credential difference from point 3. `teams/` route and `/connect/team/select` are unaffected
   (team creation/membership is untouched by any of this).
7. **Decide on tier naming (point 6 above)** separately - low urgency, no functional risk either way,
   but do it before any real catalogue import replaces `models.seed.json` so the values agree on day
   one.

Do not start this refactor without validating points 1-3 against whatever `ai-platform-tenants`'
actual (not yet written) schema looks like once a human has reviewed it - this plan proposes the
Mongo-side mirror, not the Git-side file, and the two need not be byte-identical.

**REFACTOR IMPLEMENTED 25 Sept 2026.** All six points above are done. Backend 92/92 tests pass,
frontend 176/176 tests pass, both repos lint clean.

- `teamDeployments` is now one document per `{teamId, environment}` with a `deployments[]` array
  (each entry keeps its own stable `id`, `modelSlug`, `status`, `operationId` etc. - flattened back
  to the old per-deployment `_id` shape in service responses, so routes/frontend needed no changes
  for deployment listing) plus `gateway.{credentialType, allowedDeployments, limits}` and
  `oauthClient.{enabled, appRoles}`. Reaching `active` adds the model to `gateway.allowedDeployments`.
  Every mutation is serialised behind an `acquireLockWithRetry('team-deployment:{teamId}:{environment}')`
  lock (idempotency-key/duplicate-model checks moved from a Mongo unique index into this lock, since
  several models now share one document).
- `credentials` for `tier: 'team'` are now keyed by `{teamId, environment, tier, status}` (not
  `modelSlug`) and carry `allowedDeployments: []` (extended via `$addToSet` when a second model's
  deployment reaches `active`) instead of a singular `modelSlug`. `apimSubscriptionId` changed from
  `team-{teamId}-{modelSlug}-{environment}` to `team-{teamId}-{environment}`.
- New `reserveCredentialType()` in `team-deployment-service.js` fixes `gateway.credentialType`
  (`'oauth'|'subscription-key'`) on first use per team+environment and throws `409
  credential-type-fixed` on a later mismatch. `POST /v1/credentials` accepts an optional
  `credentialType` field (team tier only, defaults to `subscription-key`) - no UI sets it yet
  (decision below), but the mechanism and mock adapter support for both are in place and tested.
  `mockCredentialIssuer.issue()`/`.rotate()` produce a distinguishable secret per type
  (`mock-key-…`/`mock-oauth-…`, vs research's unchanged `mock_…`).
- Reserved (not yet wired to any runtime gateway simulation) the `model-not-granted` stable code
  per the design pack, kept distinct from `model-not-eligible`/`deployment-not-ready`.
- Environment naming: **decided with the user** to rename now rather than defer. Policy-allowed
  team environment is `sandbox` (Phase 1's one live team-facing environment); Joi schemas accept
  `'infradev'|'sandbox'` (`infradev` is schema-valid but never policy-allowed - it's
  platform-internal). Updated in `team-deployment-service.js`, `routes/credentials.js`,
  `routes/team-deployments.js`, `models.seed.json` (`gpt-4o`/`gpt-4-1` environments), and every test
  fixture that previously used `'dev'`.
- Frontend: `manage/controller.js`'s `decorateCredential`/`buildTeamSections` read
  `allowedDeployments` (joined display names) instead of a singular `modelSlug`; `connect/team-controller.js`'s
  environment radios/schema default to `sandbox`.
- **Decided with the user:** no UI lets a team pick `oauth` vs `subscription-key` - out of scope,
  no build-story asks for it; the connect journey always requests the default `subscription-key`.
- Backend `listTeamsForUser()` now embeds each team's `role` for the caller directly, so `/manage`
  and the single-credential view page can role-gate actions with no extra per-team API call - this
  became the actual mechanism Route 3's admin-gating below relies on.

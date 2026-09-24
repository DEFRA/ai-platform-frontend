# Route 1: Research tier shared model access (B04, B06, B07)

> Part of the ["three routes to a credential"](../ui-flow-three-routes.md) journey. See also [Route 0](route0-welcome-plan.md), [Route 2](route2-plan.md), [Route 3](route3-plan.md).
>
> **STATUS: IMPLEMENTED 22 Sept 2026.** Backend 42/42 tests pass, frontend 110/110 tests pass, both
> repos lint clean. `npm run format:check` failed in both repos on a pre-existing, unrelated baseline
> (looks like CRLF vs LF) at the time - not caused by this work. Decisions/known follow-ups
> intentionally left out at the time: no Defra reskin; backend still hides ineligible models from
> the catalogue API.

Scope: ONE of three routes from the finalized UI flow (see the
[ui-flow doc](../ui-flow-three-routes.md) and build-stories
B01-B10). Route 2 (team creation, B08/B09) and Route 3 (joining a team, B07-continued/B09/B10) are
separate plans, not covered here.

Covers: decouple team capture from sign-in (B03 cleanup), build /models catalogue (B04),
restructure /connect-model -> /connect/shared/* with the missing purpose+terms step (B06),
rename /account -> /manage (B07). Backend fixes included where acceptance criteria require them.

Decisions locked in with user:
- Decouple team-name capture from sign-in (remove `/sign-in/team` step and its POST /v1/users teamName requirement). Team creation belongs to Route 2's plan (B08).
- Full scope: build /models pages + restructure connect flow + rename account->manage.
- Backend changes are in scope where needed for B04/B06/B07 acceptance criteria.

Per the AICE `javascript-design-language` skill (`.github/skills/javascript-design-language/` in
the frontend repo), its `references/layouts.md` gives concrete patterns for this plan's new pages,
used instead of plain GOV.UK templates: `/models` and `/models/{slug}` are **content pages**
(two-thirds column, `.defra-breadcrumb-bar`, no hero); `/connect/shared/*` steps are **form journey
pages** (question page pattern for `/model` and `/details`, the GOV.UK panel confirmation pattern
for the end of `/check`->`/credential`); `/manage` is a **content page** with a left sidebar nav
variant if it grows enough sections to need one. All pages still use
`.defra-header`/`.defra-primary-nav`/`.defra-footer` regardless of pattern.

## Steps

Phase A - Backend: decouple team from sign-in
1. `ai-platform-backend-api/src/routes/users.js`: drop `teamName` from the POST `/v1/users` Joi payload schema (make request just `{ email, displayName }`).
2. `ai-platform-backend-api/src/services/user-service.js`: `upsertUser()` no longer upserts/creates a team; upsert user by lowercased email only, drop `teamId` assignment. `findCurrentUser()` returns `team: null` until a team exists (Route 2's plan adds real team lookup).
3. Update `ai-platform-backend-api` tests for `users.js`/`user-service.js` accordingly (remove teamName fixtures/assertions).

Phase B - Frontend: decouple team from sign-in (*depends on Phase A*)
4. `ai-platform-frontend/src/server/routes/sign-in/controller.js`: remove the `team` sub-controller (get/post), the `teamPayloadSchema` and `teamViewModel`; after `/auth/callback` sets the pending identity, call `POST /v1/users` directly with `{ email, displayName }` and set the session, then redirect to `returnTo || '/connect'`.
5. Delete `sign-in/team.njk` view (if present) and the pending-identity redirect target `/sign-in/team`.
6. `ai-platform-frontend/src/server/common/helpers/session.js`: drop `teamId`/`teamName` from `setSessionUser`.
7. Update `sign-in/controller.test.js` to remove team-step assertions; redirect target becomes `/connect` not `/connect-model`.
8. While touching sign-in: fix session TTL in `ai-platform-frontend/src/config/config.js` from `fourHoursMs` (14400000) to 8 hours (28800000) per B03 acceptance criteria, for both `session.cache.ttl` and `session.cookie.ttl`.

Phase C - Backend: models catalogue + credential fixes (*parallel with Phase B*)
9. `ai-platform-backend-api/src/routes/health.js`: change response body to `{ status: 'ok' }` per convention.
10. `ai-platform-backend-api/src/services/models-service.js`: add a 5-minute in-process cache (e.g. simple TTL map keyed by provider+tier query) around `listEligibleModels`/`findModelBySlug` reads, invalidated on seed reload, per B04 acceptance criteria.
11. `ai-platform-backend-api/src/routes/credentials.js` + `src/services/credential-service.js`: add optional `purpose` field (string, max 500 chars) to the POST `/v1/credentials` payload schema and persist it on the credential document (needed for the check-your-answers/manage display in B06).
12. In `credential-service.js`, verify/add correct Boom error mapping: existing active credential for user+model -> `409 active-credential-exists`; model not eligible or missing `research` tier -> `403 model-not-eligible`; issuer throws -> record `status: 'failed'`, `failureReason`, and route returns `502 upstream-unavailable`. Add tests for each.
13. `ai-platform-backend-api/src/adapters/mock-credential-issuer.js`: add a deterministic way for tests to force a failure (e.g. issuer throws when `modelSlug` matches a reserved test pattern, or an injectable `shouldFail` predicate) so the 502 path in step 12 has coverage without touching production models.

Phase D - Frontend: /models catalogue pages (*depends on Phase C step 10, can start in parallel otherwise*)
14. New `ai-platform-frontend/src/server/routes/models/index.js` + `controller.js`: `GET /models` (list, `provider`/`tier` query filters via GET, calls backend `GET /v1/models`), `GET /models/{slug}` (detail, calls `GET /v1/models/{slug}`, 404 view on missing slug).
15. New Nunjucks components per stylesheets/testing conventions (`ai-platform-frontend/.github/instructions/testing.instructions.md`): `src/server/common/components/model-table/{macro,template}.njk` (+ `template.test.js`) for the catalogue list (Foundry models interactive; Bedrock/Anthropic-style entries greyed, `aria-disabled`, with `status` reason) and `src/server/common/components/code-examples/{macro,template}.njk` (+ `template.test.js`) for curl/Python/JS snippets with placeholders.
16. `/models/{slug}` detail view: summary list (provider, family, version, context window, region/data zone, tiers), use cases, best-practice links, code examples component, and a `Connect to this model` button shown only when `eligible: true` AND the user is signed in (per B04); otherwise show sign-in prompt or `Not approved` reason tag.
17. Register `models` plugin in `ai-platform-frontend/src/server/plugins/router.js` (alongside existing imports).
18. `controller.test.js` for list/detail pages, plus the two component `template.test.js` files, following existing patterns.

Phase E - Frontend: restructure /connect-model -> /connect/shared/* (*depends on Phase D for model pre-selection, Phase C step 11 for purpose field*)
19. Rename `ai-platform-frontend/src/server/routes/connect-model/` to `src/server/routes/connect/`.
20. `index.js`: register `GET/POST /connect` (access-type radios: `Shared model for research` enabled, `Dedicated model for your team` disabled with hint per B06 - replaces the old `choose-provider` step), `GET/POST /connect/shared/model` (was `select-model`, filtered to models carrying the `research` tier, pre-selected if arriving from `/models/{slug}` via query param or session), `GET/POST /connect/shared/details` (**new** - purpose textarea max 500 chars + required terms checkbox, GOV.UK error summary if unticked, no API call on failure), `GET/POST /connect/shared/check` (was `confirm` - check-your-answers, generates `Idempotency-Key`, posts `{ modelSlug, tier: 'research', purpose }` to `POST /v1/credentials`), `GET /connect/shared/credential` (was `credential.njk` - secret shown once, `Cache-Control: no-store`, excluded from bfcache).
21. `controller.js`: rewrite the choose-provider step as the access-type chooser; add the new details step handler; update check-answers handler to include `purpose` and handle `409`/`403`/`502` `ApiError` codes from `api-client.js` with the specific error pages/messages from B06's acceptance criteria (existing-credential summary + link to `/manage`, ineligible-model message, safe error + retry for 502); handle session-expiry mid-journey by redirecting to `/connect`.
22. Rename/update `.njk` views: `choose-provider.njk` -> `connect/index.njk` (access type), `select-model.njk` -> `connect/shared/model.njk`, add new `connect/shared/details.njk`, `confirm.njk` -> `connect/shared/check.njk`, `credential.njk` -> `connect/shared/credential.njk`.
23. Update `controller.test.js` and add a `journey.test.js` (no-JS) covering happy path, existing-credential (409), and terms-not-accepted scenarios per B06's acceptance criteria.

Phase F - Frontend: rename /account -> /manage (*depends on Phase E for the "Connect to a model" link target*)
24. Rename `ai-platform-frontend/src/server/routes/account/` to `src/server/routes/manage/`; update all internal paths `/account` -> `/manage`, `/account/credentials/{id}/renew` -> `/manage/credentials/{id}/renew`, `/account/credentials/{id}/revoke` -> `/manage/credentials/{id}/revoke`.
25. `index.njk`: page heading "Manage AI access"; update the empty-state link from `/connect-model` to `/connect`; add a **Your teams** placeholder section per B07 ("You are not a member of a team yet" - no link yet, since B08/team-creation isn't built in this plan).
26. Update `controller.test.js` and `journey.test.js` (currently references `/connect-model/*` mid-journey - update to `/connect/shared/*`).

Phase G - Cross-cutting cleanup (*depends on E, F*)
27. `ai-platform-frontend/src/config/nunjucks/context/build-navigation.js` (+ its test): update nav hrefs `/connect-model` -> `/connect`, `/account` -> `/manage`; add a `/models` nav entry if the design calls for one in the header.
28. Grep for any remaining `/connect-model` or `/account` references across `src/server/common/helpers/require-sign-in.test.js` and `src/server/plugins/require-sign-in-globally.test.js` fixtures and update path strings used in test assertions (logic itself is path-agnostic).

## Relevant files
- `ai-platform-backend-api/src/routes/users.js`, `src/services/user-service.js` - drop teamName from sign-in
- `ai-platform-backend-api/src/routes/health.js` - response shape
- `ai-platform-backend-api/src/services/models-service.js` - 5-min cache
- `ai-platform-backend-api/src/routes/credentials.js`, `src/services/credential-service.js` - purpose field, error code mapping
- `ai-platform-backend-api/src/adapters/mock-credential-issuer.js` - configurable failure for tests
- `ai-platform-frontend/src/server/routes/sign-in/controller.js`, `index.js` - remove team step
- `ai-platform-frontend/src/server/common/helpers/session.js` - drop team from session
- `ai-platform-frontend/src/config/config.js` - session TTL 8h
- `ai-platform-frontend/src/server/routes/models/` (new) - catalogue list + detail
- `ai-platform-frontend/src/server/common/components/model-table/`, `code-examples/` (new)
- `ai-platform-frontend/src/server/routes/connect-model/` -> renamed `connect/` - full restructure
- `ai-platform-frontend/src/server/routes/account/` -> renamed `manage/`
- `ai-platform-frontend/src/server/plugins/router.js` - register models, connect, manage
- `ai-platform-frontend/src/config/nunjucks/context/build-navigation.js` (+ test) - nav links

## Verification
1. Backend: `npm test` in ai-platform-backend-api - new/updated tests for users, credentials (409/403/502 paths), health, models cache.
2. Frontend: `npm test` in ai-platform-frontend - updated controller/journey tests for sign-in, connect, manage, models, plus new component tests.
3. Manual: sign in (no team prompt) -> browse `/models` -> open a model detail -> `Connect to this model` -> `/connect` (shared selected) -> `/connect/shared/model` (pre-selected) -> `/connect/shared/details` (purpose+terms) -> `/connect/shared/check` -> `/connect/shared/credential` (secret once) -> `/manage` shows it, renew/revoke works.
4. Lint/format: `npm run lint` and `npm run format:check` in both repos.
5. Confirm no remaining references to `/connect-model` or `/account` via a repo-wide search across both repos.

## Decisions
- Team creation/collection is fully removed from sign-in and deferred to Route 2's plan (B08) - `findCurrentUser` returns `team: null` in the interim.
- `purpose` is persisted on the credential document (not just held in session) so it can be shown on `/connect/shared/check` and potentially `/manage` later.
- Async "pending" issuer state (B05) is NOT needed for this route - Route 1's issue call is synchronous (success/fail immediately); pending/polling UI belongs to Route 2 (B09) only.

## Further considerations
1. Should `/models` get a header nav entry now, or wait until it's linked from elsewhere? Recommend: add now since it's public and this plan builds it.
2. B03's `AUTH_MODE=entra|stub` toggle (for journey test harness, B02) isn't covered here - out of scope unless bundled in.

---

## Follow-up plan (IMPLEMENTED 22 Sept 2026): make browsing + the access-type page public, gate sign-in at "Continue"

Small follow-up to the Route 1 UI above. Confirmed with user: public = Home,
About, Browse models (`/models`, `/models/{slug}`), and the `/connect` "What
kind of access do you need?" page itself (GET only, reachable via the model
detail page's `Connect to this model` link, `/connect?modelSlug=...`).
Sign-in is required starting when they click **Continue** on that page
(POST `/connect`) - everything after that (`/connect/shared/model` onward)
stays gated exactly as it is today, no change needed there since the global
sign-in gate already redirects an unauthenticated POST straight to `/sign-in`.

### Steps
1. `ai-platform-frontend/src/server/routes/connect/index.js` - add `options: { app: { public: true } }` to ONLY the `GET /connect` route. Leave `POST /connect` and every `/connect/shared/*` route exactly as-is (already private/gated by `requireSignInGlobally`).
2. `ai-platform-frontend/src/config/nunjucks/context/build-navigation.js` - move the `Connect to a model` nav entry out of the `if (getSessionUser(request))` block so it always shows (same as `Browse models`); keep `Manage AI access` inside that signed-in check.
3. `ai-platform-frontend/src/server/routes/models/controller.js` - change `canConnect: eligible && Boolean(sessionUser)` to `canConnect: eligible` (drop the sign-in requirement for showing the button); drop the now-unused `signedIn` view property.
4. `ai-platform-frontend/src/server/routes/models/detail.njk` - remove the `{% elif not signedIn %}` "Sign in to connect to this model" branch; keep only `{% if canConnect %}` (button) and `{% elif not eligible %}` (Not approved tag).
5. Update tests (*depends on 1-4*):
   - `models/controller.test.js`: replace "shows model detail with a sign-in prompt when signed out" with an assertion that the signed-out + eligible case now shows the `Connect to this model` button/link too.
   - `connect/controller.test.js`: replace "GET /connect redirects to /sign-in when signed out" with a test that GET /connect renders (200) when signed out; add a new test that POST /connect when signed out redirects to `/sign-in?returnTo=%2Fconnect`.
   - `src/server/plugins/require-sign-in-globally.test.js`: the existing "redirects an unauthenticated request for a protected route" test uses `GET /connect`, which is no longer protected - change that assertion's URL to something still gated (e.g. `/manage`), and add a case confirming `GET /connect` is reachable without a session while `POST /connect` is not.
   - `build-navigation.test.js` and `context.test.js`: add `Connect to a model` to the signed-out expected navigation array.

### Relevant files (follow-up)
- `ai-platform-frontend/src/server/routes/connect/index.js` - mark GET /connect public
- `ai-platform-frontend/src/config/nunjucks/context/build-navigation.js` (+ test) - unconditional nav link
- `ai-platform-frontend/src/server/routes/models/controller.js`, `detail.njk` (+ test) - drop sign-in requirement for the Connect button
- `ai-platform-frontend/src/server/plugins/require-sign-in-globally.test.js` - retarget the "protected route" assertion
- `ai-platform-frontend/src/config/nunjucks/context/context.test.js` - nav array fixture

### Verification (follow-up)
1. `npm test` in ai-platform-frontend - all updated/new tests green.
2. Manual: signed out, browse `/models` -> a model detail page -> `Connect to this model` -> lands on `/connect` without being redirected to sign in -> click Continue -> redirected to `/sign-in?returnTo=%2Fconnect` -> sign in -> back on `/connect` (form reset, has to re-pick access type - see Further Considerations) -> rest of the journey unchanged and still gated.

### Decisions (follow-up)
- Only `GET /connect` becomes public; every other `/connect*` route (including `POST /connect`) keeps today's default-private behaviour - no new route-level changes needed beyond the one flag.
- `/models` and `/models/{slug}` were already public from the original Route 1 build - no change needed there beyond the Connect button's visibility condition.

### Further considerations (follow-up)
1. When `POST /connect` bounces a signed-out user to `/sign-in`, the existing `requireSignIn` helper only preserves `request.path` (not query string, and never POST bodies), so a `?modelSlug=` pre-selection is lost across that detour and they land back on a blank `/connect` form after signing in. Not fixed (kept the change minimal) - would need either preserving `request.url.search` in the redirect, or stashing the pending selection server-side before redirecting.

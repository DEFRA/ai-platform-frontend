# 08 Platform admin (Teams, Deployments and Audit log tabs)

The Platform Admin area (B31, design F figures F5 to F7). The Teams tab was built 12 Nov 2026 in the frontend; it runs
against the backend's `/v1/admin/teams` routes (backend P1). The Audit log tab was built 13 Nov 2026 against the
backend's `GET /v1/admin/audit` (backend A1, same PR group). The Deployments tab was built 13 Nov 2026 against the
backend's `/v1/admin/team-deployments` routes (backend B1, same PR group; see [Deployments tab](#deployments-tab)).
Platform Admin stays the database role `platform-admin`.

| Feature                                                                      | Built       |
| ---------------------------------------------------------------------------- | ----------- |
| Admin link, `/admin`, the Teams list and a team's page                       | 12 Nov 2026 |
| Add and remove a team's members as a Platform Admin                          | 12 Nov 2026 |
| Audit log tab: filters, table, paging, link from a team                      | 13 Nov 2026 |
| Deployments tab: list, detail, Reconcile, Retry, credentials (non-federated) | 13 Nov 2026 |

## How it works

- **The backend decides.** `PUT /v1/users/me` answers `isPlatformAdmin`; the session keeps it only to show the Admin link
  (`isSessionPlatformAdmin`, after Teams). Every `/admin/**` handler calls the backend, so a person without the role, or
  with a stale link, gets the 403 page "Only a Platform Admin can use this page" (the backend records the refusal) and
  the link goes. Nothing in the frontend reads a token or a role.
- **`/admin/teams`**: a GET form (name search, status filter), 25 teams to a page, tags for Active, Disabled and Pending
  removal. The page sends only `search`, `status` and `page`; a 400 `invalid-query` is shown as an error on the field.
- **`/admin/teams/{id}`**: status tag, service code, each environment's file status with its removal date (linked to
  that environment's deployment unless removed), and the members with a Remove link. It is read-only here: Disable,
  Enable, Delete and Restore of a team are not built.
- **Members** reuse the team's own pages: `createAddMemberController(scope)` and `createPeopleSearchController` run over
  `/v1/admin/teams/{id}/people/search` and `/members`, and the `teams/add-member` and `teams/remove-member` views render
  both. The shared parts are the `add-member-form`, `members-table` and `remove-member-form` components. A Platform
  Admin cannot add themselves (`self-add-refused`); a last admin cannot be removed (`last-admin`); any team status
  allows both. The admin remove warning (13 Nov 2026) says the credentials are not changed, to revoke them if the person
  had a copy, and that a Platform Admin cannot rotate them, with a link "View the team’s deployments" to the team's first
  environment still in use (none for a team in none). It is an optional `warningLink` of the `remove-member-form`
  component; the team's own remove page passes none and is unchanged.
- Tables sit in a labelled, focusable `app-table-scroll` region so the page reflows at 320 px.
- Not built: Delete and Restore, Disable and Enable of a team, the stopped-team display, journey tests, federated
  credentials. See [remaining.md](../remaining.md).

## Audit log tab

- **`/admin/audit`** is the second tab of the Admin area (`adminTabs`). Like the Teams pages it asks the backend on every
  request (`GET /v1/admin/audit`), so a person without the role gets the 403 page and the backend records the refusal.
  Reading the log writes no event.
- **Table**: When (UK time, `Intl` with `Europe/London`, so winter and summer both show right), Who (name, and the actor
  type beneath), Action (a plain label from `audit-labels.js`; the person affected and the reason beneath, escaped and
  as the backend gave it), Team, Environment, and Outcome as a tag (Done, Failed, Refused). 25 a page, newest first,
  with "Showing x to y of z events. Events are kept for N days." (N from the backend's `retentionDays`). An action with
  no label yet shows as its code. A person or team the backend cannot name shows "Unknown person", "System" or "Team no
  longer exists". The page reads no email address, object ID or user ID; a reason is shown as typed (plan D7).
- **Filters**: a GET form "Filter the audit log" that works without JavaScript: Team and Environment (lists from the
  backend's `options`), Action (the label catalogue), Actor type (Platform Admin, Team Admin, Team member, Person with
  no team role, System), Person (part of a name, 2 to 100 characters) and From and To (date inputs in fieldsets, UK
  days, inclusive: turned into the first and last instant of the UK day, `uk-time.js`). Filters stay filled in and in
  the page links. "No events match" offers Clear filters.
- **A wrong filter** (date incomplete, not real or From after To, Person too short or long, a bad page, an actor type
  not offered, or a 400 `invalid-query`) shows the error summary and inline errors with a 400 and the title "Error: ...".
  The bad query is never sent and no events are listed, but the page makes one unfiltered `GET /v1/admin/audit` to fill
  the Team and Environment lists (the events are discarded).
- **From a team**: the team page has "View audit log" to `/admin/audit?team={id}`.
- **A page past the last** says "There is no page N", how many events and pages there are, and links to the first and
  last pages (no count over an empty table).
- **Logs**: `req.query.person` is always redacted from the request log (`logger-options.js`), as `search` is.
- The paging links are shared with the Teams list (`common/helpers/pagination.js`).
- Not built yet (DF1): credential events and the limits change carry no team or environment until the colleague's B18
  work (and backend #77) is done, so the Team and Environment filters do not find them; the Action filter does.
- The action labels include `admin.credentials.disable`, `.enable` and `.revoke` (13 Nov 2026: "Disabled a team’s
  credentials", "Enabled a team’s credentials", "Revoked a team’s credentials"), so the Action filter offers them.

## Deployments tab

Built 13 Nov 2026 against the backend's `/v1/admin/team-deployments` routes (backend B1). Every page asks the backend,
which refuses anyone without the role with the 403 page, as the other tabs do. Phase 1 changes no team-facing page, and
only non-federated credentials are in scope (federations are removed by GitOps, B18).

- **`/admin/deployments`** is the second tab (`adminTabs`: Teams, Deployments, Audit log). An environment nav of links
  (`?environment=`, `aria-current` on the one shown) shows one environment at a time; changing it starts the filters
  again. A GET form (works without JavaScript) filters by team name (2 to 100 characters), model, status (Ready,
  Setting up, Waiting, Removing, Needs attention) and credential (Active, Disabled, Revoked, None). The table (in the
  `app-table-scroll` region, hidden caption) has Team (link), Models, Status tag, Credential tag and Last change (UK
  time), 25 a page, "Showing x to y of z deployments in {environment}", paging that keeps the filters. No match shows
  "No deployments match" with Clear filters; a page past the last says so with links (`past-end.js`); a bad filter or a
  400 `invalid-query` gives the error summary and a 400. `req.query.search` is redacted from the request log.
- **`/admin/deployments/{teamId}/{environment}`**: team name as the H1, the environment as the caption and in the
  breadcrumb, the worst-state tag, a summary list (Credential status with "Disabled on {date}", Members with View team,
  Team status), buttons Disable credentials (secondary) or Enable credentials, and Revoke credentials (red), only where
  offered; View activity (`/admin/audit?team=&environment=`); the Deployment health table (Model, Status, Detail,
  Updated, Actions); and the team's other environments. An unknown team or environment is the 404 page.
- **Reconcile and Retry** are POST buttons with the CSRF crumb and the model name as hidden text. Retry shows only when
  the backend says `retryable` (`deploy-failed`, `timed-out` or held; a `checks-failed` model says the team must
  request it again, which differs from F6 note 3). Success redirects (PRG) with a banner. A 409 shows the detail page
  again with the reason in the error summary (`deployment-not-retryable` says why); a 502 is the error page.
- **Disable, Revoke and Enable** (`.../credentials/{disable,revoke,enable}`): "Which environments?" with checkboxes (the
  current one ticked; Disable offers environments not already disabled, with a hint where the credential is revoked or
  missing; Revoke those with a credential the team holds; Enable those disabled), the choice kept in the address
  (`?environments=a,b`) and checked again by the page and the API. Disable and Revoke go on to `.../reason`: a
  character count (500) "This is saved in the audit log. The team cannot see it.", the warning "Do not include names or
  contact details", the text shown as typed (escaped) and kept on an error, the error summary linked to the field and
  the title "Error: ". Disable's button is secondary and Revoke's red (design F text over the figure). Enable has no
  reason and no confirmation page: it acts and returns to the detail page with a banner.
- **One call for each environment**, each with its own `Idempotency-Key` (an HMAC of session, team, action,
  environment, the form's key and the reason, as the add-member keys are, so a retry sends the same key and another
  reason a new one). If one fails (5xx, 409) the page "We could not {disable or revoke} the credentials in {names}"
  names it, says what did complete, and links "Try again" for the failed ones; no success is shown. Otherwise PRG to
  "Credentials disabled" or "Credentials revoked" (`.../disabled`, `.../revoked`, checked against the team's
  environments).
- What the actions do in phase 1 (backend B1): Disable blocks new credentials, reveal and rotate for the team in that
  environment; Revoke deletes the secrets; the team is not told why. The hook for the gateway side (access window) is
  phase 4's.
- Environment names come from the existing `common/helpers/environment-names.js`, unchanged.

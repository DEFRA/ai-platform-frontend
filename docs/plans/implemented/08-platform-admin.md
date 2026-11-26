# 08 Platform admin (Teams, Deployments, Usage and Audit log tabs)

The Platform Admin area (B31, design F figures F5 to F7). The Teams tab was built 12 Nov 2026 in the frontend; it runs
against the backend's `/v1/admin/teams` routes (backend P1). The Audit log tab was built 13 Nov 2026 against the
backend's `GET /v1/admin/audit` (backend A1, same PR group). The Deployments tab was built 13 Nov 2026 against the
backend's `/v1/admin/team-deployments` routes (backend B1, same PR group; see [Deployments tab](#deployments-tab)).
The Usage tab was built in frontend PR #124 on 26 Nov 2026, not yet merged or deployed. Platform Admin stays the
database role `platform-admin`.

| Feature                                                                       | Built       |
| ----------------------------------------------------------------------------- | ----------- |
| Admin link, `/admin`, the Teams list and a team's page                        | 12 Nov 2026 |
| Add and remove a team's members as a Platform Admin                           | 12 Nov 2026 |
| Usage tab: every team's usage and the APIs no team owns                       | 26 Nov 2026 |
| Audit log tab: filters, table, paging, link from a team                       | 13 Nov 2026 |
| Deployments tab: list, detail, Reconcile, Retry, credentials (non-federated)  | 13 Nov 2026 |
| Deployments tab: client secrets and federations listed, Revoke one secret     | 17 Nov 2026 |
| Disable team and Enable team, and the team's view-only display                | 16 Nov 2026 |
| Remove a federated application; Retry and Reconcile by operation              | 18 Nov 2026 |
| Disable credentials says calls stop within 60 seconds; Enable shows when safe | 18 Nov 2026 |
| A team sees its credentials are disabled on the environment page              | 18 Nov 2026 |

Shipped in two parts. **S1** is on `feat/platform-admin-teams` (backend #81, frontend #98, journey tests #17). **S2** is
on `feat/platform-admin-credential-effects`, cut from S1 (18 Nov 2026, not yet pushed): the effects of Disable
credentials beyond the portal (backend, on mock adapters: [below](#known-gaps)), Remove a federated application, Retry
and Reconcile by operation, the Enable moment, and what a team sees when its credentials are disabled
([below](#credentials-disabled-as-the-team-sees-it)). What is left is in [remaining.md](../remaining.md).

## How it works

- **The backend decides.** `PUT /v1/users/me` answers `isPlatformAdmin`; the session keeps it only to show the Admin link
  (`isSessionPlatformAdmin`, after Teams). Every `/admin/**` handler calls the backend, so a person without the role, or
  with a stale link, gets the 403 page "Only a Platform Admin can use this page" (the backend records the refusal) and
  the link goes. Nothing in the frontend reads a token or a role.
- **`/admin/teams`**: a GET form (name search, status filter), 10 teams to a page, tags for Active, Disabled and Pending
  removal. The page sends only `search`, `status` and `page`; a 400 `invalid-query` is shown as an error on the field.
- **`/admin/teams/{id}`**: status tag, service code, each environment's file status with its removal date (linked to
  that environment's deployment unless removed), and the members with a Remove link. Disable team and Enable team are
  buttons here ([below](#disable-and-enable-a-team)); Delete and Restore are not built.
- **Members** reuse the team's own pages: `createAddMemberController(scope)` and `createPeopleSearchController` run over
  `/v1/admin/teams/{id}/people/search` and `/members`, and the `teams/add-member` and `teams/remove-member` views render
  both. The shared parts are the `add-member-form`, `members-table` and `remove-member-form` components. A Platform
  Admin cannot add themselves (`self-add-refused`); a last admin cannot be removed (`last-admin`); any team status
  allows both. The admin remove warning (13 Nov 2026) says the credentials are not changed, to revoke them if the person
  had a copy, and that a Platform Admin cannot rotate them, with a link "View the team’s deployments" to the team's first
  environment still in use (none for a team in none). It is an optional `warningLink` of the `remove-member-form`
  component; the team's own remove page passes none and is unchanged.
- Tables sit in a labelled, focusable `app-table-scroll` region so the page reflows at 320 px.
- Not built: Delete and Restore of a team (deferred). Journey specs for these pages are in
  `ai-platform-journey-tests` (`test/specs/post-signin/admin`). See [remaining.md](../remaining.md).

## Usage tab

Built in frontend PR #124 on 26 Nov 2026. The Usage tab reports requests, tokens and estimated costs for every team and
gateway APIs that no team owns. These reporting pages are not chargeback; the tariff and period remain to be agreed
(see [B19 in remaining work](../remaining.md#b19-team-usage-and-chargeback)).

## Audit log tab

- **`/admin/audit`** is the second tab of the Admin area (`adminTabs`). Like the Teams pages it asks the backend on every
  request (`GET /v1/admin/audit`), so a person without the role gets the 403 page and the backend records the refusal.
  Reading the log writes no event.
- **Table**: When (UK time, `Intl` with `Europe/London`, so winter and summer both show right), Who (name, and the actor
  type beneath), Action (a plain label from `audit-labels.js`; the person affected and the reason beneath, escaped and
  as the backend gave it), Team, Environment, and Outcome as a tag (Done, Failed, Refused). 10 a page, newest first,
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
- The action labels include `admin.credentials.disable` ("Disabled a team’s credentials"), `admin.credentials.enable`
  ("Enabled a team’s credentials") and `admin.credential.revoke` ("Revoked a team’s secret", since 17 Nov 2026; the
  whole-environment `admin.credentials.revoke` is no longer written and has no label), `admin.federation.remove`
  ("Removed a team’s federated application"), `admin.operation.retry` ("Retried a team’s change") and
  `admin.operation.reconcile` ("Reconciled a team’s change"), so the Action filter offers them.

## Deployments tab

Built 13 Nov 2026 against the backend's `/v1/admin/team-deployments` routes (backend B1). Every page asks the backend,
which refuses anyone without the role with the 403 page, as the other tabs do. The page changes no team-facing page.
Disable and Enable credentials also stop and restore the team's federated applications (the service principal switch,
a mock until Entra admin consent: [known gaps](#known-gaps)); a federated application is removed one at a time (below).

- **`/admin/deployments`** is the second tab (`adminTabs`: Teams, Deployments, Audit log). An environment nav of links
  (`?environment=`, `aria-current` on the one shown) shows one environment at a time; changing it starts the filters
  again. A GET form (works without JavaScript) filters by team name (2 to 100 characters), model, status (Ready,
  Setting up, Waiting, Removing, Needs attention) and credential (Active, Disabled, Revoked, None). The table (in the
  `app-table-scroll` region, hidden caption) has Team (link), Models, Status tag, Credential tag and Last change (UK
  time), 10 a page, "Showing x to y of z deployments in {environment}", paging that keeps the filters. No match shows
  "No deployments match" with Clear filters; a page past the last says so with links (`past-end.js`); a bad filter or a
  400 `invalid-query` gives the error summary and a 400. `req.query.search` is redacted from the request log.
- **`/admin/deployments/{teamId}/{environment}`**: team name as the H1, the environment as the caption and in the
  breadcrumb, the worst-state tag, a summary list (Credential status with "Disabled on {date}", Members with View team,
  Team status), the Client secrets list (id ending, expiry, status; a Revoke link beside each active secret only), the
  Federated credentials table (name, kind, status, actions; shown only when the team has any, with the note "Disable
  credentials also stops these federated applications; Enable credentials restores them."), buttons Disable credentials (secondary) or Enable credentials, only where
  offered; View activity
  (`/admin/audit?team=&environment=`); the Deployment health table (Model, Status, Detail, Updated, Actions); and the
  team's other environments. An unknown team or environment is the 404 page.
- **Reconcile and Retry** are POST buttons with the CSRF crumb and the model name as hidden text. Retry shows only when
  the backend says `retryable` (`deploy-failed`, `timed-out` or held; a `checks-failed` model says the team must
  request it again, which differs from F6 note 3). Success redirects (PRG) with a banner. A 409 shows the detail page
  again with the reason in the error summary (`deployment-not-retryable` says why); a 502 is the error page.
- **Disable and Enable credentials** (`.../credentials/{disable,enable}`): "Which environments?" with checkboxes (the
  current one ticked; Disable offers environments not already disabled, with a hint where the credential is revoked or
  missing; Enable those disabled), the choice kept in the address (`?environments=a,b`) and checked again by the page
  and the API. Disable goes on to `.../reason`: a character count (500) "This is saved in the audit log. The team cannot
  see it.", the warning "Do not include names or contact details", the text shown as typed (escaped) and kept on an
  error, the error summary linked to the field and the title "Error: ". Disable's button is secondary. Enable has no
  reason and no confirmation page: it acts and returns to the detail page with a banner. The Enable page shows, as inset
  text, a sentence for each environment it lists: the moment from which no token issued before the Disable can work
  again, the `servicePrincipalDisabledAt` of that environment's entry in the backend's read plus 2 hours and 60
  seconds, in UK time (`enableNote` in `credential-actions.js`; design F, "Enable after a leak"); where none is
  recorded it says so. A 502
  `upstream-unavailable` from Disable or Enable shows the failure page with Try again, and the block stays.
- **Revoke one client secret** (`.../credentials/{credentialId}/revoke`, `deployment-secret-revoke.js`): the Revoke link
  beside an active secret opens a reason page that is also the confirmation (red button). There is **no
  whole-environment Revoke** (removed 17 Nov 2026, R-D5): Entra cannot disable one secret, so Disable credentials is the
  reversible stop and Revoke is for one secret, for good. The page says the truth of design F as built in S1: no new token
  can be made with the secret, a token already issued keeps working until it expires, up to 2 hours, to stop calls now
  also use Disable credentials on this deployment, and the team's other
  secrets are not changed. Success returns to the detail page with "Revoked the secret
  ending {last four}." A secret that is not active is sent back to the deployment with a notice.
- **Remove a federated application** (`.../federations/{federationId}/remove`, `deployment-federation-remove.js`, T11):
  a Remove link beside each application that is ready or failed (not one being set up or removed) opens a reason page
  that is also the confirmation (red button, the same `credential-reason` view as Revoke one secret). It posts the
  reason to `POST /v1/admin/team-deployments/{teamId}/{environment}/federations/{federationId}/remove` with an
  `Idempotency-Key` from the shared helper (session, team, environment, application, the form's key and the reason). The
  page says it cannot be undone, that the application gets no new token, that a token already issued works until it
  expires (up to 2 hours), that Disable credentials is the immediate stop, and that the team's other applications and
  secrets are unchanged. 202 or 200 returns to the deployment with a banner ("Removal requested for {name}. The table
  shows where it is.", or "already removed"), and the row shows Removing. 400 `reason-required` and `reason-too-long`
  are shown on the field; 404 `federation-not-found` and 409 `federation-in-progress` return to the deployment with a
  notice; a 5xx or another 409 (a reused key) is the failure page "We could not remove the application {name}" with
  Try again. The reason is never in the page or a log.
- **Retry and Reconcile by operation** (`.../operations/{operationId}/{retry,reconcile}`, `deployment-operations.js`,
  T11): the Actions column of the federated credentials table shows Reconcile beside an application whose change failed
  or that the backend says is `retryable` (a failed apply, a timed-out or held change), and Retry only when `retryable`.
  The Deployment health table gets a "Limits change" row while the backend gives `limitsOperation` (a limits-only change
  that failed, timed out or is held; the table shows even when the team has no models), with Reconcile and, when
  `retryable`, Retry. The page offers and accepts only operations the deployment lists (`federations[].operationId` and
  `limitsOperation.id`), and the backend decides the rest: 202 returns with a banner; 409 `operation-not-retryable` and
  other 409s, and 404 `operation-not-found`, show the detail page again with the reason in the error summary, linked to
  the table; a 502 is the error page.
- **One call for each environment** (Disable), each with its own `Idempotency-Key` (an HMAC of session, team, action,
  environment, the form's key and the reason, as the add-member keys are, so a retry sends the same key and another
  reason a new one). If one fails (5xx, 409) the page "We could not disable the credentials in {names}" names it, says
  what did complete, and links "Try again" for the failed ones; no success is shown. Otherwise PRG to "Credentials
  disabled" (`.../disabled`, checked against the team's environments).
- What the actions do (backend B1, S2): Disable blocks new credentials, reveal and rotate for the team in that
  environment, refuses a federation request or change there (removing an application stays allowed), writes the team's
  access window `suspended` and switches the registration's service principal off, so calls stop; Enable reverses it.
  The page says calls stop within 60 seconds (design F, "When it bites"; not yet measured). Revoke one secret removes
  that secret, so no new token can be made with it. Neither tells the team why. The secret-revoke page, the remove-member
  warning and the Disable team note say Disable credentials is how to stop calls now.
- <a id="known-gaps"></a>**Known gaps**: the backend's access window and service principal switch are **mock adapters**
  (the mock is refused in `prod`), so Disable credentials changes nothing at the gateway or in Entra yet; the real
  Microsoft Graph adapter and the 60-second measurement wait for Entra admin consent (HVE #87), and the API Management
  role change in `ai-platform-infra` (T20) must be released and pinned first. The Enable moment shows only where the
  backend has recorded `servicePrincipalDisabledAt` for that environment, otherwise "There is no record ...". A revoked
  secret is not listed (the backend lists active and expired ones), so the page's Revoked tag for a secret cannot
  show. See [remaining.md](../remaining.md).
- Environment names come from the existing `common/helpers/environment-names.js`, unchanged.

## Disable and enable a team

Built 16 Nov 2026 (run `2026-11-16-disable-team`) against the backend's `POST /v1/admin/teams/{id}/disable` and
`/enable`. A disabled team is **view-only in the portal**: its status is `disabled`, optionally with some environments
(`disabledEnvironments`) also disabled. Nothing reaches the gateway: credentials and models keep working, no GitOps
operation is queued. To stop calls an admin uses Disable credentials on the deployment (above); revoking one secret
stops new tokens only. The people never see a reason or
an admin's name.

- **Admin pages** (`admin/team-lifecycle.js`; they reuse the credential flow's templates, reason rule, form key and error
  codes). **A team is environment-agnostic, so Disable team and Enable team never touch an environment** (19 Nov 2026,
  hve #85): an environment is disabled only by Disable credentials, which lists it in the team's
  `disabledEnvironments` (and Enable credentials removes it). The team page offers exactly one of a secondary **Disable
  team** (team active) and a primary **Enable team** (team disabled, whatever its environments), and none for a team
  waiting to be removed. Disable team goes straight to `/admin/teams/{id}/disable` (1 to 500 characters; no environment
  choice), makes one call with an `Idempotency-Key` (HMAC of session, team, form key and reason) and returns to the team
  page with a success notification, which now shows Enable team. Enable team is a POST button on the team page with a
  CSRF crumb, one call, no reason; a failure is an error notification on the team page. A failed Disable is the page "We
  could not disable {team}" with Try again. 403 page for non-admins. The team page warns separately of a disabled team
  ("view it but not change its details or members; its environments, models and credentials are not affected") and of a
  disabled environment (its credentials are disabled and the team cannot deploy, add or rotate secrets or change
  anything else there). The audit log labels `admin.team.disable` and `admin.team.enable` and the refusal code
  `team-disabled`. The admin deployment page shows exactly one of Disable credentials and Enable credentials.- **Team pages** (`common/helpers/team-lock.js`; `loadTeamForView` adds `lock`): a banner on the team's tabs and the
  team's tabs ("This team is disabled. You can view it but you cannot change its details or members."); an environment's page says "This environment is disabled" only when the environment is, the team Disabled, and a
  disabled environment tagged Disabled (ahead of Paused). **Team-wide** actions (details, add, change and remove a
  member, set up an environment) are greyed while the team is disabled, with nothing ticked; **environment** actions
  (deploy and remove a model, limits, view and rotate the client secret, create, change and remove an application) only
  in a disabled environment; an environment not ticked stays Available. Buttons are disabled `govukButton`s, links
  plain text. Revoking a client secret stays open. A locked page, or a backend `409 team-disabled`, shows "You cannot
  change this team" (409) with a link back (`catchAll` for the backend's refusal). The request and Federate journeys do
  not offer a disabled environment (the dry run's `team-disabled`).
- **Recent changes** (overview and environment page) also read `GET /v1/teams/{team}/status-changes` and merge "Team
  disabled by the platform team" and "Team enabled by the platform team" newest first within the same 10 rows; a failed
  read shows "We could not read the changes just now".
- Not built: Delete and Restore of a team (see [remaining.md](../remaining.md)).

## Credentials disabled, as the team sees it

Built 18 Nov 2026 (S2, T13) against the backend's `credentialsDisabled` on the team's environment read. It is separate
from the team lock above: the environment stays Available and the team is never told why.

- **Environment page** (`environment-view.js`, `credentialsBanner` in `common/helpers/team-lock.js`, the
  `team-lock-banner` partial): a notification banner "Credentials are disabled" says what cannot be done (add, view or
  rotate a client secret; create or change a passwordless credential) and what still can (revoke a secret, remove an
  application). Add, View, Rotate, Federate and Change are greyed (plain text, nothing linked); Revoke and Remove stay
  links. On the team's overview, "Create Passwordless Credential" is greyed when every environment with room has its
  credentials disabled (or is locked).
- **A refused action** (`409 credentials-disabled`, from a stale page or a typed address): the shared error handling
  shows "Credentials are disabled" with a 409 and a link back to the team's environments (`errors.js`,
  `credentialsDisabledPage`). The change-application page and the add-secret page refuse the same way before calling
  the backend.

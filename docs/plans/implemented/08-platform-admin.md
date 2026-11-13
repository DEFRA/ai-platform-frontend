# 08 Platform admin (Teams and Audit log tabs)

The Platform Admin area (B31, design F figures F5 and F7). The Teams tab was built 12 Nov 2026 in the frontend; it runs
against the backend's `/v1/admin/teams` routes (backend P1). The Audit log tab was built 13 Nov 2026 against the
backend's `GET /v1/admin/audit` (backend A1, same PR group). Platform Admin stays the database role `platform-admin`.

| Feature                                                 | Built       |
| ------------------------------------------------------- | ----------- |
| Admin link, `/admin`, the Teams list and a team's page  | 12 Nov 2026 |
| Add and remove a team's members as a Platform Admin     | 12 Nov 2026 |
| Audit log tab: filters, table, paging, link from a team | 13 Nov 2026 |

## How it works

- **The backend decides.** `PUT /v1/users/me` answers `isPlatformAdmin`; the session keeps it only to show the Admin link
  (`isSessionPlatformAdmin`, after Teams). Every `/admin/**` handler calls the backend, so a person without the role, or
  with a stale link, gets the 403 page "Only a Platform Admin can use this page" (the backend records the refusal) and
  the link goes. Nothing in the frontend reads a token or a role.
- **`/admin/teams`**: a GET form (name search, status filter), 25 teams to a page, tags for Active, Disabled and Pending
  removal. The page sends only `search`, `status` and `page`; a 400 `invalid-query` is shown as an error on the field.
- **`/admin/teams/{id}`**: status tag, service code, each environment's file status with its removal date, and the
  members with a Remove link. It is read-only here: Disable, Enable, Delete and Restore are not built.
- **Members** reuse the team's own pages: `createAddMemberController(scope)` and `createPeopleSearchController` run over
  `/v1/admin/teams/{id}/people/search` and `/members`, and the `teams/add-member` and `teams/remove-member` views render
  both. The shared parts are the `add-member-form`, `members-table` and `remove-member-form` components. A Platform
  Admin cannot add themselves (`self-add-refused`); a last admin cannot be removed (`last-admin`); any team status
  allows both. The remove warning names no credential object (it says to ask a team admin to rotate or revoke the
  team's credentials), so it stays true when B18 lands.
- Tables sit in a labelled, focusable `app-table-scroll` region so the page reflows at 320 px.
- Not built: Deployments tab, Disable, Enable, Delete and Restore, the stopped-team display, journey tests.
  See [remaining.md](../remaining.md).

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

# 08 Platform admin (Teams tab: list, team page, members)

The first part of the Platform Admin area (B31, design F figure F5). Built 12 Nov 2026 in the frontend; it runs against
the backend's `/v1/admin/teams` routes (backend P1). Platform Admin stays the database role `platform-admin`.

| Feature                                                | Built       |
| ------------------------------------------------------ | ----------- |
| Admin link, `/admin`, the Teams list and a team's page | 12 Nov 2026 |
| Add and remove a team's members as a Platform Admin    | 12 Nov 2026 |

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
- Not built: Deployments and Audit log tabs, Disable, Enable, Delete and Restore, the stopped-team display, journey tests.
  See [remaining.md](../remaining.md).

# 01 Portal journeys (routes 0 to 3)

What a person can do in the portal today. Every item is built and merged. The flow itself is in
[ui-flow-three-routes.md](../../flat-design-updates/v1/ui-flow-three-routes-v1.md); the tiers behind it are in
[02 Research tier](02-research-tier.md) and [03 Team tier](03-team-tier.md).

| Route | What it covers                                                                | Built                        |
| ----- | ----------------------------------------------------------------------------- | ---------------------------- |
| 0     | Home page `/`, the shared entry point                                         | 29 Sept 2026                 |
| 1     | Research tier: browse models, request a personal key, manage it               | 22 Sept 2026                 |
| 2     | Team tier: create or pick a team, request dedicated models for it             | 23 Sept 2026 (refactored 25) |
| 3     | Team tier: join a team that already has access, role rules, rotate and revoke | 25 Sept 2026                 |
| -     | Flat Defra design (header, navigation, footer, tables, label formatting)      | 29 Sept 2026                 |

## Sign in

- Defra Entra ID through OIDC (`openid-client`), refused outside the allowed email domains, session held
  server-side (`@hapi/yar`, `maxCookieSize: 0`).
- A person is keyed on the immutable Entra `oid` and `tid`. Email is for display only and is **not unique**,
  so never look a person up by email. Every GitOps change is attributed to `entra:{oid}`.

## Pages

| Page                                   | Does                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/`                                    | Start page. Signed in, one inset per team with an active client secret, naming the models it covers.  |
| `/models`, `/models/{slug}`            | Catalogue list and detail, with ineligible or retired models greyed out and their reason shown.       |
| `/connect/shared/*`                    | Request a research key: model, purpose and terms, one-time reveal.                                    |
| `/connect/team/*`                      | Request one or several models for a team, wait page, client secret.                                   |
| `/teams`, `/teams/new`, `/teams/{id}`  | Create or select a team, members and roles, service code, the team's models.                          |
| `/manage`                              | One table of keys and client secrets (personal and team), a "Your models" table, a "Your teams" list. |
| `/manage/credentials/{id}` and `/view` | Credential detail, renew, rotate, revoke, and an audited re-reveal with a required reason.            |

## Rules worth knowing

- Research keys are **renewed**, never rotated. Team secrets are **rotated**, never renewed. Rotate issues a new
  secret without changing expiry or the renewal count.
- Only a team Admin can rotate or revoke the team credential; a Member sees status only.
- Another team's credential returns `404`, not `403`, so its existence is not disclosed.
- A new request for a model whose key has `expired` is refused with `409 credential-expired-use-renew`.
- A key that never finished issuing is not listed as usable on `/manage`.
- A journey belongs to the person who started it and is dropped for anyone else; sign-out ends the whole session.
- Buttons that call the backend (`.app-button--loading-on-submit`) disable themselves and show a spinner, so a slow
  renew or issue cannot be repeated by clicking again.

## Where the code is

- Frontend: `src/server/routes/{home,models,connect,teams,manage,sign-in}/`, labels in
  `src/config/nunjucks/filters/format-label.js`, row shaping in `manage/access-view.js`, navigation in
  `src/config/nunjucks/context/build-navigation.js`.
- Backend: `src/routes/` and `src/services/` for `users`, `models`, `credentials`, `teams`, `team-deployments`.
- Design: `docs/flat-design-updates/v1/build-spec-v1.md` and `_govuk-frontend.scss`.

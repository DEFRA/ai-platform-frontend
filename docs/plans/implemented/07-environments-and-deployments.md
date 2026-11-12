# 07 Environments and deployments (B30)

The section where a team sees what is deployed in each environment, deploys and changes it, and follows each change,
one team at a time. Designed 11 Nov 2026 (discovery-docs design F `#environments`, figures F2 to F4, choices J to P
accepted 12 Nov 2026) and built 12 Nov 2026 in frontend pull request P2, which depends on the backend's P1 (team
environment reads, operations, limits change). Deploy, remove and limits are real through GitOps in Infradev; applications,
connection details and client secrets sections are B18's (P8, P9) and are not here yet. Not deployed: G3 is not approved.

| Feature                                                                            | Built       |
| ---------------------------------------------------------------------------------- | ----------- |
| Service navigation: Model catalogue, Personal access, Teams, Environments, Help    | 12 Nov 2026 |
| `/environments`, the overview, an environment's page, "Change team"                | 12 Nov 2026 |
| Deploy a model carrying the team and environment; set up another environment       | 12 Nov 2026 |
| Admin changes limits within the catalogue's bounds (question, check, one change)   | 12 Nov 2026 |
| Changes in progress and recent changes with steps, times, failure reason, run link | 12 Nov 2026 |
| Teams page: Overview tab replaces Models, redirects from the old addresses         | 12 Nov 2026 |

## Pages and addresses

| Address                                          | What it is                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/environments`                                  | The person's own teams. One team redirects to its overview; none offers "Create a team".                                                                 |
| `/environments/{team}`                           | Overview: "Deploy a model", a card per environment slot (Available, Paused or "Not available yet", greyed with no actions), Changes in progress, Recent. |
| `/environments/{team}/{env}`                     | One environment (registry code, for example `infradev`): the strip with this one current, changes here, Models, Limits, Recent changes.                  |
| `/environments/{team}/{env}/limits` and `/check` | An Admin's question page and check answers; a Member gets 403.                                                                                           |
| `/environments/{team}/{env}/set-up`              | Set up another environment from the models ready in the first (moved from `/teams/{slug}/{name}`, which now redirects, 301).                             |
| `/connect/team/start?teamId=&environment=`       | Deploy a model with the team (slug or id) and environment already chosen: no team or environment question; Back returns to the page it came from.        |

- The address carries the team; every read is for that team only and the backend answers 404 to a non-member
  (`not-a-member`), so a person learns nothing about another team. An environment that is unknown or not in
  `TEAM_ENVIRONMENTS` is 404 before the backend is asked.
- Environment code, not display name, is the address segment (`infradev` and `dev` both read "Development").
- The Teams page shows Overview (the models the team uses, a count of models and applications per environment, a link to
  the section), Members and Details. `/teams/{slug}/models` redirects to `/environments/{team}`. Remove a model and the
  client secret pages (view, rotate, revoke) go back and return to the environment's page.

## How it works

- Pages: `src/server/routes/environments/` (`controller.js`, `limits-controller.js`, `set-up-controller.js`, views in
  `environment-view.js` and `operation-view.js`, backend calls in `environments-api.js`); the strip is the
  `environment-strip` component; the step list gains a `failed` state.
- Overview reads `GET /v1/teams/{team}/environments` first (the gate), then the open and recent changes, the catalogue
  names and the person's team list; an environment page reads `.../environments/{env}`, then the team (for the role), the
  environment's changes, the catalogue and the person's credentials (read after the environment, which is what grants a
  model that just turned active its team secret). A failed read of changes, names or credentials leaves the page up and says so.
- Progress: the status (changes, models, limits, recent) is `?fragment=status`, swapped into a polite live region by
  `progress-refresh.js` every 5 s while a change is open, with an ETag and `no-store`; "Check progress" reloads it without
  script. Steps are the backend's five (Request received, Checks passed, Deploying, Deployed, Ready to use) with their
  times; a failed step shows the reason, an https run link and the `AIP-` reference.
- Limits: the answers are checked against the bounds the backend sends for the environment (D5: the catalogue's
  `capacityPolicy`) to say what is wrong in words, and again by the backend (`400 limits-out-of-bounds`, `409
limits-unchanged`, `409 environment-not-set-up`, `403 admin-required`, `409 idempotency-key-reused`). Each set of
  answers gets one `Idempotency-Key`, kept in the session until the change is made, so asking again is the same request.

## Not here

Applications, connection details and client secret management on the page (B18, P8 and P9), the journey tests (P3),
usage and costs, approvals, and the earlier mock-up's pipeline, health and promotion; see
[../remaining.md](../remaining.md).

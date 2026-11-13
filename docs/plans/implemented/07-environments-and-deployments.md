# 07 Environments and deployments (B30), with the applications of B18

The section where a team sees what is deployed in each environment, deploys and changes it, and follows each change,
one team at a time. Designed 11 Nov 2026 (discovery-docs design F `#environments`, figures F2 to F4, choices J to P
accepted 12 Nov 2026) and built in frontend pull request P2 (#93, merged 13 Nov 2026), which depends on the backend's P1
(#77: team environment reads, operations, limits change). Deploy, remove and limits are real through GitOps in Infradev
once deployed. B18's applications, the Federate journey and connection details (design E `#team-credentials`, figures E6
and F4) were built in pull request P8 (#94, merged 13 Nov 2026), which depends on P2 and the backend's P6 (#78); they run
against the mocks (nothing is created in Entra while `entra.enabled` is false). The portal says "Create Passwordless
Credential" where the design says "Federate an application". The backend's client secret routes are merged (#79); the
frontend client secrets section (P9) is not built. Not deployed to Infradev: G3 is not approved.

| Feature                                                                                  | Built       |
| ---------------------------------------------------------------------------------------- | ----------- |
| Service navigation: Model catalogue, Personal access, Teams, Environments, Help          | 12 Nov 2026 |
| `/environments`, the overview, an environment's page, "Change team"                      | 12 Nov 2026 |
| Deploy a model carrying the team and environment; set up another environment             | 12 Nov 2026 |
| Admin changes limits within the catalogue's bounds (question, check, one change)         | 12 Nov 2026 |
| Changes in progress and recent changes with steps, times, failure reason, run link       | 12 Nov 2026 |
| Teams page: Overview tab replaces Models, redirects from the old addresses               | 12 Nov 2026 |
| Applications on an environment's page: tags, used of 20, Change and Remove for an Admin  | 12 Nov 2026 |
| Federate journey: where, CDP name or Azure ID and name, environments, check, progress    | 12 Nov 2026 |
| Connection details with Copy, the placeholder notice, "How to get a token"               | 12 Nov 2026 |
| Set-up offers the CDP services federated before; the request's ready page recommends one | 12 Nov 2026 |

## Pages and addresses

| Address                                               | What it is                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/environments`                                       | The person's own teams. One team redirects to its overview; none offers "Create a team".                                                                         |
| `/environments/{team}`                                | Overview: "Deploy a model", "Create Passwordless Credential" while an environment has room, a card per slot, Changes in progress, Recent.                        |
| `/environments/{team}/{env}`                          | One environment (registry code, for example `infradev`): the strip, changes here, Models, Limits, Applications, Recent changes, Connection details.              |
| `/environments/{team}/{env}/limits` and `/check`      | An Admin's question page and check answers; a Member gets 403.                                                                                                   |
| `/environments/{team}/{env}/set-up`                   | Set up another environment from the models ready in the first (moved from `/teams/{slug}/{name}`, which now redirects, 301).                                     |
| `.../set-up/applications`                             | Which CDP services federated in the first environment this one should trust (choice B), each ticked; asked only when there are some; the check lists the answer. |
| `/environments/{team}/federate` and `/service`        | Where it runs (radios), then the CDP service name. `?environment=` carries the environment it started from.                                                      |
| `.../federate/principal-id`, `/name`                  | Azure: the managed identity's principal ID, then a name. `/environments` asks which environments (checkboxes, skipped when one has room), `/check` confirms.     |
| `.../federate/progress`                               | A step list for each environment, in a polite live region (`?fragment=status`); then the ready panel with links to each environment's connection details.        |
| `/environments/{team}/{env}/applications/{id}/change` | An Admin's Change: asks the same questions again from the application's values, then the check; no environments question.                                        |
| `/environments/{team}/{env}/applications/{id}/remove` | An Admin's Remove, after a warning (new tokens stop, existing ones work until they expire); the application shows Removing.                                      |
| `/connect/team/start?teamId=&environment=`            | Deploy a model with the team (slug or id) and environment already chosen: no team or environment question; Back returns to the page it came from.                |

- The address carries the team; every read is for that team only and the backend answers 404 to a non-member (the body
  is the same as an unknown team's), so a person learns nothing about another team. An environment that is unknown or not
  in `TEAM_ENVIRONMENTS` is 404 before the backend is asked.
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
- Progress: the status (changes, models, limits, applications, recent) is `?fragment=status`, swapped into a polite live
  region by `progress-refresh.js` every 5 s while a change is open, with an ETag and `no-store`; "Check progress" reloads it
  without script. Steps are the backend's, with their times; a failed step shows the reason, an https run link and the
  `AIP-` reference.
- Limits: the answers are checked against the bounds the backend sends for the environment (D5: the catalogue's
  `capacityPolicy`) to say what is wrong in words, and again by the backend (`400 limits-out-of-bounds`, `409
limits-unchanged`, `409 environment-not-set-up`, `403 admin-required`, `409 idempotency-key-reused`). Each set of
  answers gets one `Idempotency-Key`, kept in the session until the change is made, so asking again is the same request.
- Applications (`federation-view.js`, `federation-urls.js`): from `Detail.applications` (used of 20 and each
  application's state); a full registration says why and offers no Federate link, and the overview's button stays while
  any environment has room. Only an Admin sees Change (a ready application) and Remove (ready or failed); the backend
  refuses a Member with 403 and another team's application with 404.
- Federate journey (`federate-*.js`, `federation-journey.js`, `federation-answers.js`): one question to a page, with the
  name rules checked as the backend and `validate` check them. The answers wait in the session with one
  `Idempotency-Key`; the same answers keep it, different ones get another, and the check page posts back the key it showed.
  The environments question asks the backend's dry run (`POST .../federations/check`) once, offers the environments with
  room, and names an environment that refuses (never the other team). Confirming asks for one request (`POST
.../federations`), which makes one operation for each environment, so one can fail alone; the progress page reads each
  operation. A Change is one `PATCH` and a Remove one `DELETE` (`409 federation-in-progress` while it settles).
- Connection details (`partials/connection.njk`): every value is text in the page; "Copy" is a button the script reveals
  (`copy-value` component, `application.js`). The placeholder notice shows while the backend flags the values an
  example. "How to get a token" shows the client credentials request, `GET {gateway}/whoami` and the model call
  (`POST {gateway}/openai/v1/chat/completions`, or `/responses` by the model's `apiProfile`, with no key and no
  `api-version`: plan D8). It sits outside the live region so the Copy buttons are not swapped out.
- Choices B and C: setting up another environment asks which CDP services to add (any federated in the first
  environment that the new one does not hold, ticked), and the confirmed ones are asked for after the request, one request
  each with a key of its own; a refusal is said on the page that follows and never undoes the request. The request's ready
  page recommends federating each CDP service that will call the model.

## Not here

Client secret management on the page (B18, P9), the journey tests (P3, P10), usage and costs, approvals, and the earlier
mock-up's pipeline, health and promotion; see [../remaining.md](../remaining.md). Known gap: the backend refuses a
federation in an environment with no team file yet (`environment-not-set-up`), so the services chosen while setting up a
new environment are added only once it is set up; until the backend queues them behind the first request, the person is
told and federates them from the environment's page.

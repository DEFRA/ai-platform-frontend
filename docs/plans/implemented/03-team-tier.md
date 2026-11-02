# 03 Team tier (teams, dedicated models, GitOps provisioning)

Teams, roles, dedicated model deployments and the GitOps path that builds them. Built 23 Sept to 28 Oct 2026; live in
Infradev and in CDP dev.

| Feature                                                              | Built              |
| -------------------------------------------------------------------- | ------------------ |
| Teams, members, Admin and Member roles                               | 23 to 25 Sept      |
| One credential per team per environment, rotate and revoke by Admin  | 25 Sept 2026       |
| Team model: slug, service code, last-Admin guard, current team       | 14 Oct 2026        |
| `TenantOrchestrator` through GitOps (pull request, apply, ARM check) | merged 19 Oct 2026 |
| Admin removes a model through GitOps                                 | 18 Oct 2026        |
| Verification finishes and says why it did not (R6)                   | merged 20 Oct 2026 |
| Honest status labels (R7) and a labelled placeholder secret (R5)     | merged 20 Oct 2026 |
| B28: operations, queues and direct commits replace the pull request  | merged 28 Oct 2026 |
| B28: progress from a status fragment, no meta refresh                | merged 28 Oct 2026 |

## Teams and roles

- Create or select a team; the creator is the first Admin. Admin and Member are shown in the portal; the stored
  values stay `admin` and `user`.
- The **last Admin can never be demoted or removed**, and not as half of a promote-and-leave request: promote, then
  leave. Role changes run under a team lock and are audited.
- Each team has an immutable `slug`, **derived from its name** (a clash takes a numbered suffix) and shown as "Team ID".
  It names the team's GitOps file, gateway API path and deployments, so a rename never changes it.
- A required three-character `serviceCode` (`^[A-Z0-9]{3}$`) that an Admin can change. It is checked through a
  `ServiceCodeVerifier` port with only a mock adapter, so every team shows "To be verified". A team needs one before
  its first request (`409 service-code-required`).
- A person belongs to several teams and acts in one at a time (`currentTeamId` in the session).
- Environments a team can deploy to come from `TEAM_ENVIRONMENTS` on both sides (default `infradev`), not from code.

## Requesting models

- `/connect/team/*` takes **several models at once**: one deployment per model, the first in flight and the rest
  queued, idempotent by a key made when the answers are given. One change per team file at a time, so a later request
  waits as `queued`.
- The wait page follows every model, then shows one client secret that covers them all.
- An Admin removes an `active` model from the team page (confirm page, then
  `DELETE /v1/teams/{teamId}/deployments/{id}`): a GitOps `remove` follow-up, `removing` then `removed`, back to
  `active` with a reason if it fails. Team decommission has no portal path yet.

## GitOps provisioning

- Since B28 (backend #58, 28 Oct 2026; plan in discovery-docs `docs/async-operations-plan.md`),
  `TENANT_ORCHESTRATOR=sqs` (or `mock` locally) records one operation per request per team file, with its outbox, in
  the same MongoDB write. Requests for several models of one team and environment are one operation, one commit and one
  apply; a later request for the same file waits as `queued`. The backend publishes a command to its SNS topic; the
  GitOps worker (`ai-platform-worker`) dispatches `submit.yml`, which validates the whole document at the pin and
  commits it to `main` as the GitHub App, with no pull request. `submit` and the apply send status events to the
  backend's events queue. The document is built from the file `main` holds now, so an engineer's edit and the team's
  federations and limits survive a later request.
- States: `queued`, `requested`, `committed`, `deploying`, `deployed`, `verified`, `active`, and the failures
  `checks-failed`, `deploy-failed` and `timed-out`. The pull-request states `pr-raised` and `merged` are gone.
- Failure policy (design D14): one fresh apply, then a revert of the whole operation. The backend's sweeper reconciles an
  overdue operation once through the worker (deadlines: `requested` 10 min, `committed` 30, `deploying` 45, `deployed`
  15), then marks it `timed-out`. Platform Admin retry and reconcile stay
  (`POST /v1/admin/team-deployments/{id}/retry` and `/reconcile`).
- While an admin has paused the environment (`AIP_PAUSED`), requests show as "Waiting", keep their file and commit
  nothing, and continue after `resumed`.
- The wait page and the team Models tab update from a status fragment every 5 s with script (a polite live region; no
  meta refresh) and offer "Check progress" without it. The steps are Request recorded, Change committed, Setting up
  {model} in Azure, Checking your resources in Azure and Preparing your client secret. The wait page has no pipeline
  links; the failure page links the submit run and the apply run under "Technical details for the AI Platform team".
- Verification keeps the verifier's reason, counts attempts (`GITOPS_VERIFY_MAX_ATTEMPTS`, default 5), audits and logs
  each failure, then fails the deployment with the reason (for example `environment-not-configured`). A Platform
  Admin retry resets the count. An active model lists its Foundry project, deployment and API by name.
- Status labels are mapped explicitly in `deployment-status.js`: "Setting up" means only the five in-progress states
  (`requested` to `verified`), `queued` reads "Waiting", the three failures read "Setup failed", `active` reads "Ready
  to use", and an unknown status, `pr-raised` and `merged` included, reads "Status unknown".
- The backend corroborates a failure event by reading the run-report artifact from the GitHub Actions run, which
  redirects to
  `productionresultssaN.blob.core.windows.net`. CDP's proxy must allow that host (see [../remaining.md](../remaining.md)).

## Team credentials

- Team credentials are **OAuth client secrets** (decision of 14 Oct 2026); the pages say "client secret", never "key".
- One credential per team per environment covers every model the team has. Its `allowedDeployments[]` is read from the
  team's deployments on every response and never stored, so a removed model leaves it at once.
- **Placeholder:** `MOCK_TIERS=team` keeps the team issuer on a mock, so every page showing a mocked team secret carries
  one shared inset saying it does not work with the gateway yet. Research keys are unaffected. The mock vault is in
  memory, so a restart loses the secret. Removing this is part of B18 in [../remaining.md](../remaining.md).

## Where the code is

- Backend: `src/operations/` (operations, outbox, events, sweeper), `src/adapters/sqs/`,
  `src/adapters/github/github-team-file-reader.js`, `src/services/team-deployment-*.js`, `team-desired-state.js`
  (builds the document; tests validate it against the copied infra team schema), `team-deployment-view.js` (progress
  steps). README section "GitOps operations".
- GitOps worker: `ai-platform-worker` (README: commands, reconcile, dead-letter runbook).
- Frontend: `src/server/routes/connect/` (`team-*`), `src/server/routes/teams/`,
  `src/server/common/helpers/deployment-status.js`.
- Cross-repo design: `ai-platform-discovery-docs` design F (teams), design C (orchestration), and
  `docs/iac-baseline-plan.md`.

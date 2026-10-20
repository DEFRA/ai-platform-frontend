# 03 Team tier (teams, dedicated models, GitOps provisioning)

Teams, roles, dedicated model deployments and the GitOps path that builds them. Built 23 Sept to 20 Oct 2026; live in
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

- `TENANT_ORCHESTRATOR=github` dispatches `submit.yml` with the whole team document and tracks it to `active`: pull
  request, merge, GitHub Deployment, run report, then an ARM check. The document is built from the file `main`
  holds now, so an engineer's edit and the team's federations and limits survive a later request.
- Failure policy (design D14): retry once, then revert; a scheduler sweep and Platform Admin retry and reconcile.
- The wait page links to the run and pull request under "Details for the AI Platform team".
- Verification keeps the verifier's reason, counts attempts (`GITOPS_VERIFY_MAX_ATTEMPTS`, default 5), audits and logs
  each failure, then fails the deployment with the reason (for example `environment-not-configured`). A Platform
  Admin retry resets the count. An active model lists its Foundry project, deployment and API by name.
- Status labels are mapped explicitly in `deployment-status.js`: "Setting up" means only the six in-progress states,
  `active` reads "Ready to use", and an unknown status reads "Status unknown". The wait page's steps are Request
  recorded, Team checked, Setting up access in Azure (`merged`, `deploying`), then Preparing your client secret
  (`deployed`, `verified`).
- The backend's apply detection reads the run-report artifact from the GitHub Actions run, which redirects to
  `productionresultssaN.blob.core.windows.net`. CDP's proxy must allow that host (see [../remaining.md](../remaining.md)).

## Team credentials

- Team credentials are **OAuth client secrets** (decision of 14 Oct 2026); the pages say "client secret", never "key".
- One credential per team per environment covers every model the team has. Its `allowedDeployments[]` is read from the
  team's deployments on every response and never stored, so a removed model leaves it at once.
- **Placeholder:** `MOCK_TIERS=team` keeps the team issuer on a mock, so every page showing a mocked team secret carries
  one shared inset saying it does not work with the gateway yet. Research keys are unaffected. The mock vault is in
  memory, so a restart loses the secret. Removing this is part of B18 in [../remaining.md](../remaining.md).

## Where the code is

- Backend: `src/adapters/github/github-tenant-orchestrator.js`, `src/services/team-deployment-*.js`,
  `team-desired-state.js` (builds the document; tests validate it against the copied infra team schema),
  `team-deployment-view.js` (progress steps). README section "GitOps tenant orchestrator".
- Frontend: `src/server/routes/connect/` (`team-*`), `src/server/routes/teams/`,
  `src/server/common/helpers/deployment-status.js`.
- Cross-repo design: `ai-platform-discovery-docs` design F (teams), design C (orchestration), and
  `docs/iac-baseline-plan.md`.

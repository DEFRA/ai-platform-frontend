# 05 Platform infrastructure and GitOps pipeline

How the Azure platform and teams are created: Terraform and reusable workflows run from GitHub Actions, never by hand.
Applied in Infradev from 15 Oct 2026; CDP dev runs the portal against it from 20 Oct 2026.

| Feature                                                                 | Built       |
| ----------------------------------------------------------------------- | ----------- |
| Pipeline: infra modules and `aip-checks`, workflows, state repositories | 15 Oct 2026 |
| Platform applied in Infradev (APIM, Foundry, vaults, Log Analytics)     | 15 Oct 2026 |
| A team applied end to end from the portal                               | 15 Oct 2026 |
| Rulesets, auto-merge of validated team pull requests (removed by B28)   | 18 Oct 2026 |
| Gateway guard, removal lifecycle, destroy cap, locks (infra #16)        | 19 Oct 2026 |
| Research tier IaC and `autoPin` releases (v0.9.0, v0.9.1)               | 20 Oct 2026 |
| CDP dev wired to Infradev (config, proxy rules)                         | 20 Oct 2026 |
| B28 asynchronous operations: queues, GitOps worker, direct commits      | 28 Oct 2026 |
| B28 status events from the workflows; CDP grant to the events identity  | 29 Oct 2026 |

## The repositories

| Repository                   | Holds                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `ai-platform-infra` (public) | Modules, schemas, the model catalogue, `aip-checks`. Released with release-please (`v0.10.3`). |
| `ai-platform-workflows`      | Reusable workflows and composite actions, called at `@v2` (`v2.0.4`).                          |
| `ai-platform-worker`         | The GitOps worker (CDP service, `0.1.0`): takes the backend's commands and dispatches runs.    |
| `ai-platform-environments`   | `registry.json` and per-environment parameters; a merge dispatches that environment's apply.   |
| `ai-platform-deployments`    | The platform pin, `environments/{env}/platform.json`; a merge applies the platform.            |
| `ai-platform-tenants`        | One file per team, `environments/{env}/{slug}.json`, plus the platform-owned `research.json`.  |

## How a change flows

1. The backend records one operation per team file with its outbox and sends a command to an SQS FIFO queue; the GitOps
   worker dispatches `submit.yml`, which validates the whole document and commits it to `main` as the GitHub App, with no
   pull request (B28, backend #58, worker #1).
2. The commit applies: the platform first, then tenants, only at the platform's release.
3. `submit`, the apply and `pause.yml` publish status events to the backend's events queue as `id-aip-events-{env}`: a v1
   Entra token for the deploy registration, exchanged with AWS STS for CDP's role. The run report keeps every event.

- Each state repository needs the `AZURE_TENANT_ID` repository variable and the `AIP_EVENTS_*` variables in its `{env}` and
  `{env}-events` Environments.
- `autoPin: true` in the registry means an `ai-platform-infra` release submits, merges and applies its own pin with no
  confirmation. Set it to `false` in `ai-platform-environments` if applies must stay manual.
- Plan-guard refuses every delete in the platform state; a repository admin (`aice-platform-admins`) dispatches
  `apply.yml` with `allow_destroy=true`.
- Break-glass changes (a person editing state) use `break-glass/{incident}` branches, two approvals from other people, and
  `aip-checks canonical` for the file form.
- Rulesets: `aip-machine-main` (tenants and deployments; a pull request with a code-owner review and the `validate`
  check, bypassed only by the `submit` App) and `aip-machine-protect` (no force push or deletion, no bypass);
  `aip-human-main` (infra, workflows, environments); `aip-release-tags` on `v*`. `.github/` in the state repositories is
  code-owned by `aice-platform-admins`.
- Who may run what (the admin check, workflows `v2`): a hand `submit`, any hand dispatch of `apply.yml`, `pause.yml`,
  and `allow_destroy` or `force_unlock` need the repository admin role, for the actor and whoever re-ran it. Engineers
  re-run failed jobs of portal and push runs and dispatch `reconcile-all.yml`, which also runs nightly (02:17 in
  tenants, 02:43 in deployments).
- Pause: an admin sets `AIP_PAUSED` to `true` in the `{env}-events` Environment and runs `pause.yml`; portal requests
  then wait, keep their file and commit nothing until `resumed`. Runbook: discovery-docs `docs/async-operations-plan.md`
  section 13.
- Dead letters: a command that fails three times goes to the worker's dead-letter queue, an event to the backend's;
  runbooks in the worker's README and plan section 13.
- `settings-drift.yml` (workflows, daily) checks the state repositories' rulesets, Environments and audit log. It does
  not work yet: see [remaining.md](../remaining.md), section 7, "Settings drift".

## Infradev today

- Subscription `7f8da4be-...`, resource group `SNDAIEAIPRGP1401`, API Management `apim-aip-infradev` (Developer SKU),
  Foundry account `aif-aip-infradev` (UK South only), tenants vault `sndaipappkvt1402`, `network.mode: public-minimal`.
- `entra.enabled` is `false` (the deploy identity has no Graph permission) and the interim flag `entra.teamRegistrations`
  skips only the per-team Entra registration.
- Teams: `cool-team`, `bobs-team`, `dans-team`, `team-test-1` to `team-test-5`, `team-dev-1`, and test teams added
  through the portal since B28 (19 files on 30 Oct 2026), and the `research` file.
- `gpt-4o` has a UK South `Standard` team SKU and runs at capacity 1; the nano models have no SKU there that the UK or EU
  rule allows, so they are not offered.

## CDP dev

- `cdp-app-config` carries the backend settings: `PROVISIONING_MODE=live`, `AZURE_ARM_AUTH_METHOD=federated`,
  `RESEARCH_ENVIRONMENT`, `AIP_ENVIRONMENTS`, `CATALOGUE_REF=v0.9.1`, `TENANT_ORCHESTRATOR=sqs` (from B28; the backend
  accepts only `sqs` or `mock`), `GITOPS_COMMANDS_TOPIC_ARN`, `GITOPS_EVENTS_QUEUE_URL`, `TEAM_ENVIRONMENTS=infradev`,
  `MOCK_TIERS=team`; the worker's `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITOPS_COMMANDS_QUEUE_URL` and
  `GITOPS_EVENTS_TOPIC_ARN`; and the frontend's `RESEARCH_ENVIRONMENT` and `GATEWAY_BASE_URLS`. Config applies only on
  redeploy.
- Messaging (`cdp-tenant-config`, one owner per queue): the backend publishes commands to its topic
  `aip_gitops_commands`, which feeds the worker's queue `aip_gitops_commands_worker`; the worker publishes reconcile
  events to its topic `aip_gitops_events_worker`, which feeds the backend's queue `aip_gitops_events`, where the
  workflows also send. All FIFO, with dead-letter queues.
- The backend authenticates to Azure with a federated credential (CDP's AWS web identity token exchanged for an Entra
  token); no client secret exists in CDP. Locally it uses `client-secret`.
- Secrets in the CDP Portal: `GITHUB_APP_PRIVATE_KEY` in the backend (read-only tokens, for the catalogue, team files
  and run reports) and in the worker (dispatch); one GitHub App for both until the identity split before any
  environment beyond Infradev.
- Proxy: `cdp-tenant-config` allows the backend `management.azure.com`, `.vault.azure.net` and `api.github.com`, and the
  worker `api.github.com` and `.blob.core.windows.net`; `login.microsoftonline.com` is a default rule.

## Operating notes

- A reusable workflow gets no secrets unless the caller passes `secrets: inherit`.
- Approvals by the last pusher do not count (`require_last_push_approval`); another person must approve after the last push.
- Retry a failed apply by re-running its failed jobs (an engineer may, for the latest portal or push run; a run that is
  no longer the head of `main` is refused as `superseded`) or by dispatching `reconcile-all.yml`. A fresh hand dispatch
  of `apply.yml` needs the repository admin role.
- The infra pin is in `ai-platform-deployments`, not `registry.json`; a registry change that affects the apply must land
  before the pin.
- Local run: Mongo with `docker compose --env-file <empty file> up -d mongodb` (compose cannot parse a `//` comment in the
  backend `.env`), Redis from the frontend compose file, the backend with `node --env-file-if-exists=.env ./src`, the
  frontend with `npm run dev`.
- On Windows set `$env:TZ='UTC'` (and `$env:AWS_EMF_ENVIRONMENT='Local'` for the frontend) and run `npx vitest run`;
  `npm --prefix X exec vitest` runs in the current directory, so give `--root`. Some backend and frontend tests time
  out in a full run under load but pass alone.
- Agent terminal: write long output to a `$env:TEMP` file and read it; `gh --jq` with pipes breaks (use `ConvertFrom-Json`);
  `az --query` with brackets breaks (filter in PowerShell).

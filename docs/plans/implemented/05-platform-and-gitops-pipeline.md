# 05 Platform infrastructure and GitOps pipeline

How the Azure platform and teams are created: Terraform and reusable workflows run from GitHub Actions, never by hand.
Applied in Infradev from 15 Oct 2026; CDP dev runs the portal against it from 20 Oct 2026.

| Feature                                                                 | Built       |
| ----------------------------------------------------------------------- | ----------- |
| Pipeline: infra modules and `aip-checks`, workflows, state repositories | 15 Oct 2026 |
| Platform applied in Infradev (APIM, Foundry, vaults, Log Analytics)     | 15 Oct 2026 |
| A team applied end to end from the portal                               | 15 Oct 2026 |
| Rulesets, auto-merge of validated team pull requests                    | 18 Oct 2026 |
| Gateway guard, removal lifecycle, destroy cap, locks (infra #16)        | 19 Oct 2026 |
| Research tier IaC and `autoPin` releases (v0.9.0, v0.9.1)               | 20 Oct 2026 |
| CDP dev wired to Infradev (config, proxy rules)                         | 20 Oct 2026 |

## The repositories

| Repository                   | Holds                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `ai-platform-infra` (public) | Modules, schemas, the model catalogue, `aip-checks`. Released with release-please (`v0.9.1`). |
| `ai-platform-workflows`      | Reusable workflows and composite actions, called at `@v1` (`v1.1.1`).                         |
| `ai-platform-environments`   | `registry.json` and per-environment parameters; a merge dispatches that environment's apply.  |
| `ai-platform-deployments`    | The platform pin, `environments/{env}/platform.json`; a merge applies the platform.           |
| `ai-platform-tenants`        | One file per team, `environments/{env}/{slug}.json`, plus the platform-owned `research.json`. |

## How a change flows

1. The portal (or a release) dispatches `submit.yml` with a whole document; the pull request is validated by
   `validate-desired-state / validate` and merged by the machine ruleset (`aip-machine-main`) without a person.
2. Merging applies: the platform first, then tenants, only at the platform's release.
3. The apply writes a run report; the portal reads it to learn the operation finished.

- `autoPin: true` in the registry means an `ai-platform-infra` release submits, merges and applies its own pin with no
  confirmation. Set it to `false` in `ai-platform-environments` if applies must stay manual.
- Plan-guard refuses every delete in the platform state; an engineer dispatches `apply.yml` with `allow_destroy=true`.
- Break-glass changes (a person editing state) use `break-glass/{incident}` branches, two approvals from other people, and
  `aip-checks canonical` for the file form.
- Rulesets: `aip-machine-main` (tenants and deployments), `aip-human-main` (infra, workflows, environments),
  `aip-release-tags` on `v*`.

## Infradev today

- Subscription `7f8da4be-...`, resource group `SNDAIEAIPRGP1401`, API Management `apim-aip-infradev` (Developer SKU),
  Foundry account `aif-aip-infradev` (UK South only), tenants vault `sndaipappkvt1402`, `network.mode: public-minimal`.
- `entra.enabled` is `false` (the deploy identity has no Graph permission) and the interim flag `entra.teamRegistrations`
  skips only the per-team Entra registration.
- Teams: `cool-team`, `bobs-team`, `dans-team`, `team-test-1` to `team-test-5`, `team-dev-1`, and the `research` file.
- `gpt-4o` has a UK South `Standard` team SKU and runs at capacity 1; the nano models have no SKU there that the UK or EU
  rule allows, so they are not offered.

## CDP dev

- `cdp-app-config` carries the backend settings: `PROVISIONING_MODE=live`, `AZURE_ARM_AUTH_METHOD=federated`,
  `RESEARCH_ENVIRONMENT`, `AIP_ENVIRONMENTS`, `CATALOGUE_REF=v0.9.1`, `TENANT_ORCHESTRATOR=github`,
  `TEAM_ENVIRONMENTS=infradev`, `MOCK_TIERS=team`; and the frontend's `RESEARCH_ENVIRONMENT` and `GATEWAY_BASE_URLS`.
  Config applies only on redeploy.
- The backend authenticates to Azure with a federated credential (CDP's AWS web identity token exchanged for an Entra
  token); no client secret exists in CDP. Locally it uses `client-secret`.
- Secrets in the CDP Portal: `GITHUB_APP_PRIVATE_KEY` (the GitHub App also used for the catalogue).
- Proxy: `cdp-tenant-config` allows the backend `management.azure.com`, `.vault.azure.net` and `api.github.com`;
  `login.microsoftonline.com` is a default rule.

## Operating notes

- A reusable workflow gets no secrets unless the caller passes `secrets: inherit`.
- Approvals by the last pusher do not count (`require_last_push_approval`); another person must approve after the last push.
- Retry a failed apply with a fresh dispatch of `apply.yml`, never a re-run.
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

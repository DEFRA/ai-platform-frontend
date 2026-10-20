---
ms.date: '2026-10-20'
---

# IaC rollout state

Goal: Infradev Terraform pipelines applying through GitHub Actions, then the portal creating teams through them (task prompt: `.github/prompts/iac.prompt.md`).
Never apply without owner confirmation; only resource group `SNDAIEAIPRGP1401`.

The research tier's move onto this pipeline is planned separately in
[research-tier-infradev-plan.md](research-tier-infradev-plan.md).

## Done (15 Oct 2026)

- **Pipeline built and released:** `ai-platform-workflows` v1.1.0 (`v1` moved), `ai-platform-infra` v0.7.0, `ai-platform-environments` registry, tenants and deployments callers, all merged. The App key is the repository secret `GITOPS_APP_PRIVATE_KEY` plus the variable `GITOPS_APP_CLIENT_ID` in all five repos; only real environments are GitHub Environments (`infradev` in tenants and deployments, `main` only).
- **Platform applied through the pipeline:** first pin `v0.5.0` (`ai-platform-deployments` #2), then `v0.6.0` (#3) and `v0.7.0`. The first apply needed `allow_destroy=true` (break-glass) for the Key Vault role replacement; later applies are tag-only. `entra.enabled` is `false` for `infradev` (environments #2) because the deploy identity has no Graph permission.
- **Interim flag:** registry `entra.teamRegistrations` (infra #12, workflows #8) skips only the per-team Entra app registration; with `entra.enabled: false` a team applies without one.
- **Catalogue:** `gpt-4o` has a UK South `Standard` team SKU (infra #14); `gpt-4.1-nano` and `gpt-5-nano` are Global-only in UK South, so their team SKUs stay in Sweden Central.
- **Portal to team apply proven** (local portal, Infradev): `cool-team` + `gpt-4o` -> `Submit` run -> `ai-platform-tenants` #2 -> validate -> merged by hand -> tenants apply, 9 added: Foundry project `aip-cool-team`, deployment `cool-team-gpt-4o` (Standard, capacity 1), APIM API `cool-team`, no Entra registration.
- Local tooling: Terraform 1.16.5 and `jq` installed; the tenants Terraform tests and the `apply.sh` integration tests pass locally.

## Gotchas

- A reusable workflow gets no secrets unless the caller passes `secrets: inherit`, even environment ones.
- The `gh` CLI is the owner's account: approvals by the last pusher do not count (`require_last_push_approval`); another person must approve after the last push.
- No required status checks on any repo's `main` yet: release-merge refuses to auto-merge release PRs, and `submit.yml` ends with "Pull request is in clean status" because auto-merge cannot be enabled on an already mergeable PR. Merge release PRs and team PRs by hand until an admin adds the rulesets.
- The infra pin is `environments/{env}/platform.json` in `ai-platform-deployments`, not `registry.json`; merging it triggers the platform apply, so a registry change that affects the apply must land before it.
- Infradev's `autoPin: true` means an `ai-platform-infra` release submits, merges and applies its own pin with no confirmation step: v0.9.0 did so on 20 Oct 2026 (3 added, 6 changed, 0 destroyed; tenants 8 changed in place). Set `autoPin` to `false` in `ai-platform-environments` if applies must stay manual.
- Plan-guard refuses every delete in the platform state; an engineer dispatches `apply.yml` with `allow_destroy=true` for an expected replacement.
- The backend `CATALOGUE_REF` must be a release with team tiers (v0.7.0), not v0.2.0; restart the backend after changing it.
- Local run: start Mongo with `docker compose --env-file <empty file> up -d mongodb` (compose cannot parse the `//` comment in the backend `.env`), Redis from the frontend compose file, the backend with `node --env-file-if-exists=.env ./src` (the `npm run dev` watcher restarts on `.git` changes and printed nothing), the frontend with `npm run dev`.
- On Windows set `$env:TZ='UTC'` (and `$env:AWS_EMF_ENVIRONMENT='Local'` for the frontend) and run `npx vitest run`, since `npm test` uses Unix env syntax. The frontend `start-server.test.js` times out in the full run but passes alone.
- Agent terminal: write long output to a `$env:TEMP` file and read it; `gh --jq` with pipes breaks, use `ConvertFrom-Json`; `az --query` with brackets breaks, filter in PowerShell.

## Left to do

**Open pull requests (20 Oct 2026)**

- `cdp-tenant-config` #2024: lets the dev backend download GitHub Actions artifacts (`.blob.core.windows.net`); until it deploys a team deployment stays on "Setting up access in Azure" after its apply succeeds.
- `ai-platform-discovery-docs` #27 (promotion plan) and `ai-platform-infra` #24 (Terraform quality plan review).
- Dependabot bumps: infra #9, workflows #2, frontend #36 to #42, backend #36 and #37, journey-tests #9 and #10.

**Merged since 15 Oct 2026:** backend #35 and frontend #35 (orchestrator, run links), infra #16 and workflows #10 (gateway guard, removal lifecycle, destroy cap), discovery-docs #21, #22, #25 and #26, the research tier (infra v0.9.0 and v0.9.1, tenants #16, backend #40, frontend #46), and the CDP dev config (cdp-app-config #4933 and #4935).

**State of the workspace (20 Oct 2026)**

- Every repository is on `main` and up to date, with no uncommitted work.
- Teams `cool-team`, `bobs-team`, `dans-team`, `team-test-1` to `team-test-5` and `team-dev-1` (created from CDP dev) exist in Infradev and `ai-platform-tenants`, alongside the platform-owned `research` file.

**Resolved on 18 Oct 2026 (hardening round)**

- The team-facing environment is configuration, not code: backend `TEAM_ENVIRONMENTS` and frontend `TEAM_ENVIRONMENTS` (default `infradev`), offered on the details step; the `sandbox` constant and the local `infradev` edits are gone.
- An admin can remove a model from the team page (`DELETE /v1/teams/{teamId}/deployments/{id}`, a GitOps `remove` follow-up). Team decommission is handled by the IaC checks (`pending-removal` → `removed` → delete, with a cooling-off period) but has no portal path yet.
- Rulesets are in place: `aip-machine-main` on tenants and deployments requires `validate-desired-state / validate` with no approvals, so team PRs auto-merge (with a merge-when-validated fallback in `submit.js`; a change outside `environments/` fails that check closed and merges through the `ai-dev-team` pull-request bypass); `aip-human-main` on infra, workflows and environments; `aip-release-tags` on `v*`. Stray Environments deleted. See `ai-platform-workflows` README "Repository settings" and `scripts/setup/repo-settings.sh`.

**Admin tasks**

- Org Actions allow-list for the workflows the callers use.
- Entra consent for the deploy and backend identities (`Application.ReadWrite.OwnedBy`); then set `entra.enabled` back to `true` (with `teamRegistrations: false` only if just the team registration is still blocked) and remove the interim flag.

**Research tier (19 Oct 2026)**

- The research tier is built by this pipeline in Infradev from 20 Oct 2026: `research.json` (`gpt-4o` only; the nano models have no UK South SKU) applied with 8 added, 0 destroyed after infra v0.9.1. The portal still points at the hand-built `SNDAIEEXPRGP1401`, API Management `DEPLOYTESTDEFRA`, vault `kv-aip-sandbox-tenants` and Foundry `sndaieinfst1401aiefoundry` until backend #40 and frontend #46 merge and `cdp-app-config` is updated.
- **The Portal API principal holds no API Management role on the Infradev instance** — only Key Vault Secrets Officer on the tenants vault. It mints research keys by `PUT`ing an API Management subscription through ARM, so repointing configuration alone would fail at the first key issue. No built-in role is narrow enough; the plan builds a custom role with the six subscription actions and assigns it at the API Management resource. Terraform owns both (19 Oct 2026) — the deploy identity has User Access Administrator, so no further grant is needed, but the definition and assignment must be idempotent across repeated applies.
- Plan and phases: [research-tier-infradev-plan.md](research-tier-infradev-plan.md).

**Decisions and gaps**

- Sweden Central for Infradev (Defra policy exception), then add `swedencentral` to `environments/infradev/platform.tfvars.json` `azure.foundry.regions`; until then team models are those with a UK South non-Global SKU.
- `gpt-4o` Standard quota in UK South: capacity 1 worked; larger capacities untested.
- Team OAuth client secret (Phase 5 B18) needs the Entra consent; until then the last wait-page step cannot complete.
- Turn off `operator_state_access` once the pipeline is accepted; clean up `%TEMP%\wt-docs` and `%TEMP%\wt-infra7`.
- Update `docs/implemented-features.md` and discovery-docs `build-stories.md#status`.

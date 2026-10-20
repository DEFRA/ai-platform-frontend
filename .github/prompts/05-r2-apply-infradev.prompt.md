---
mode: agent
description: 'R2 - apply the research tier to Infradev: parameters, the pin, the platform-owned research.json, and the apply itself.'
---

You are implementing **Phase R2** of
`ai-platform-frontend/docs/plans/in-progress/research-tier-infradev-plan.md`. Read that phase and
"Pipeline ordering" in full first.

**Requires R1 released.** Do not start otherwise.

## Repositories

`ai-platform-environments`, `ai-platform-deployments`, `ai-platform-tenants`.

## The rule that overrides everything else in this session

**Never apply without the owner's explicit confirmation, and only within resource group
`SNDAIEAIPRGP1401`.** Show the plan, say what it will create, change and destroy, and wait. This
rule is in `docs/plans/in-progress/iac-rollout-state.md` and is not negotiable.

## Order

Bootstrap is done. Then: **platform apply, then tenants apply.** The platform carries R1's schema
and module changes; the tenants apply builds the research project, its account-child deployments
and the `research` API from the platform-owned file.

1. Pin the new infra release in `ai-platform-deployments` `environments/infradev/platform.json`.
2. Commit `research.json` to `ai-platform-tenants/environments/infradev/`.
3. `entra.enabled` stays `false` and the `entra.teamRegistrations` interim flag stays as it is -
   research needs neither.

To keep every apply manual, dispatch `apply-state.yml` with the `state` input rather than relying
on the pin merge, and set Infradev's `autoPin` to `false` so an infra release does not submit the
pin behind you.

## What to check in the plan output before confirming

- Parameterising `modules/apim-team-api` must **not** force a replacement of the existing
  `cool-team` API.
- Research capacity must leave the environment inside its pooled quota - every deployment of a
  model draws on the same TPM pool as every team's.
- Plan-guard refuses every delete in the platform state. If an expected replacement needs
  `allow_destroy=true`, that is a separate dispatch and a separate confirmation.

## Gotchas from the last applies

- A reusable workflow gets no secrets unless the caller passes `secrets: inherit`.
- The pin lives in `ai-platform-deployments`, not `registry.json`; a registry change that affects
  the apply must land first.
- Agent terminal: write long output to a `$env:TEMP` file and read it. `gh --jq` with pipes breaks,
  use `ConvertFrom-Json`; `az --query` with brackets breaks, filter in PowerShell.

## Done when

The research project, its deployments and the `research` API exist in Infradev; a key minted by
hand against the API returns a completion; a second apply shows no drift and leaves the custom role
and its assignment untouched.

Record the resources actually created, **by name**, in
`ai-platform-frontend/docs/plans/in-progress/iac-rollout-state.md`, and add a dated note to the
research tier plan.

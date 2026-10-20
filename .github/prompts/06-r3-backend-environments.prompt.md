---
mode: agent
description: 'R3 - make the research tier environment-aware: resolve Azure from AIP_ENVIRONMENTS, persist environment on a credential, backfill.'
---

You are implementing **Phase R3** of
`ai-platform-frontend/docs/plans/in-progress/research-tier-infradev-plan.md`. Read that phase in
full first.

Code can be written against R1's branch, but it **lands after R2 has applied** - the portal must
never point at a resource the platform has not built.

## Repository

`ai-platform-backend-api`.

## What this moves away from

The research tier currently reads four flat config keys that describe one hand-built environment:
`armAuth.subscriptionId`, `armAuth.resourceGroup`, `apim.serviceName`, `keyVault.vaultName` -
pointing at `SNDAIEEXPRGP1401`, `DEPLOYTESTDEFRA` and `kv-aip-sandbox-tenants`.

`AIP_ENVIRONMENTS` already exists and already carries subscription, resource group, API Management
name, Foundry accounts and tenants vault per environment. It is used today only by the team
deployment ARM verifier. Research now resolves from it too, keyed by a new `RESEARCH_ENVIRONMENT`.

`armAuth` keeps **authentication only**: tenant, client, auth method, federated audience. Do not
remove it - `azure-credential.js` builds the credential from it and is scope-agnostic.

## The migration seam - the point of the whole phase

Every lifecycle path - revoke, rotate, renew, reveal and `reconcilePendingCredentials` - reads the
**credential's own** `environment`, never the current configuration. That is what lets a credential
issued in a previous environment still revoke correctly, and makes a future move a configuration
change plus natural expiry rather than a data migration. Check every one of those paths.

## Deployment names

The research path does **not** translate, so the deployment name the caller puts in the URL is the
one Azure holds, and the catalogue's `deploymentName` stays the right field. Keep it. What must be
true is that it matches the research file's `deployments[]` exactly - that reconciliation is R1's
check, not a runtime concern.

## Constraints

- Follow `.github/copilot-instructions.md` and `schema-changes.instructions.md`. The new
  `environment` field needs a dated backfill using an aggregation-pipeline `updateMany`, setting
  `sandbox` on existing research credentials only, and defensive reads until it has run everywhere.
- Adapters take the resolved environment settings as **parameters** - no config reads inside the
  adapter. That is the dependency inversion rule this repo already follows.
- The startup guard must refuse to boot in live mode when the named environment is missing from
  `AIP_ENVIRONMENTS` or has no API Management name or tenants vault. Fail closed, loudly.
- Extend `credential-issuer-contract.js` - a new adapter or changed behaviour is proved by that
  suite, not by prose. Nock the new ARM paths.
- `nock` needs `globalThis.fetch` restored in ARM test files; the repo's global
  `vitest-fetch-mock` setup clobbers fetch otherwise.
- Never log a full secret. `keyHint` everywhere but the two reveal points.
- On Windows run tests with `$env:TZ='UTC'` then `npx vitest run`.
- Before finishing: `npm run format`, then `format:check`, `lint` and `test` pass.

## Done when

A research credential is issued, revealed, rotated and revoked against Infradev, with `issuerKey`
proving it was not mocked, and the key calls the gateway and returns a completion.

Then update `docs/implemented-features.md` and add a dated note to the plan.

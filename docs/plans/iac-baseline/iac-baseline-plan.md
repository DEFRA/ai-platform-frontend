# IaC baseline: GitOps from the Portal API to Azure (Phase 1, SND1)

> Cross-cutting plan, not a journey route. See also the
> ["three routes to a credential"](../../ui-flow-three-routes.md) journey
> ([Route 2](../route2-plan.md) builds the team flow this plan provisions for real) and the other
> cross-cutting plans, [research-tier-integration-plan.md](../integration/research-tier-integration-plan.md)
> and [centralised-gateway-plan.md](../centralised-gateway/centralised-gateway-plan.md).
>
> Direction: design pack areas [A](../../../../ai-platform-discovery-docs/src/content/design-environments.md),
> [B](../../../../ai-platform-discovery-docs/src/content/design-repositories-pipelines.md),
> [C](../../../../ai-platform-discovery-docs/src/content/design-orchestration.md),
> [D](../../../../ai-platform-discovery-docs/src/content/design-infrastructure.md) and
> [E](../../../../ai-platform-discovery-docs/src/content/design-identity.md); the 12 Oct 2026 decisions below
> are recorded there in a separate discovery-docs pull request.
>
> **STATUS: NOT STARTED (approved 12 Oct 2026).** Update this line as each workstream lands and add a
> dated note at the bottom recording what actually happened versus what is written here.
>
> No real tenant, subscription, resource or app registration identifiers in this file: this repository
> is public. Real values live in the internal `ai-platform-environments` repository and in GitHub
> Environment variables.

## Goal

The team flow (team file, dedicated model, team credential) runs against a mock `TenantOrchestrator`.
Nothing real sits between the Portal API and Azure: no Terraform, workflows, state or pins, and the IaC
repositories are empty apart from `ai-platform-infra/catalogue/`.

Build the smallest complete GitOps path in the target shape, proven end to end in SND1 (`infradev`), so
later environments add data, not code:

`Portal API → dispatch "submit" with the whole JSON document → workflow validates at the pinned release,
commits as the App on op/{operationId}, opens a PR, auto-merge → offline checks → merge → reusable apply
workflow (deploy identity via OIDC) → Portal API polls GitHub and ARM → active → team credential works`.

Platform releases use the same path: `ai-platform-infra` merge → release-please tag → pin submitted to
`ai-platform-deployments` → platform apply → tenants apply at the same release.

## Decisions (12 Oct 2026)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | SND1 is environment `infradev` (design A); `sandbox` stays reserved for SND4. The backend gets a configurable team-environment list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D2  | A new **public minimal platform** in SND1, Terraform-managed, with design names: `rg-aip-infradev-platform`, `apim-aip-infradev` (Developer, 1 unit, SKU from environment config), `aif-aip-infradev` (UK South, local auth off), `kv-aip-infradev-platform`, `kv-aip-infradev-tenants`, `law-aip-infradev`, `appi-aip-infradev`. No VNet, Redis, private endpoints or policy assignments. The private topology later **replaces** it (no dual path). The hand-built Research resources stay untouched.                                                                                                  |
| D3  | Backend split: this plan builds the submit and status adapter (WS5); the Teams developer builds the desired-state builder and team-record changes (WS6). Both sections can move to their own plan files when required.                                                                                                                                                                                                                                                                                                                                                                                   |
| D4  | OAuth teams in scope behind `entra.enabled` per environment: `api-aip-infradev` and `app-aip-infradev-{slug}` with federated credentials through `azuread`. The Graph identity is configurable: the deploy identity, or an existing registration that already holds `Application.ReadWrite.OwnedBy`.                                                                                                                                                                                                                                                                                                     |
| D5  | Identities by role: GitHub App `ai-platform-orchestrator` acts on GitHub only; `id-aip-deploy-infradev` is, in Phase 1, the existing GitHub Actions app registration with federated credentials only (no secret); `id-aip-backend-infradev` is, in Phase 1, the existing Portal API app registration (APIM keys, Key Vault, ARM verify, later Graph `addPassword` as co-owner).                                                                                                                                                                                                                          |
| D6  | **Submit pattern** (as CDP's portal writes tenant config). The Portal API never commits: it dispatches `submit.yml` in the state repository with the whole document and keeps the run ID the dispatch returns (pinned `X-GitHub-Api-Version`); the reusable `submit-desired-state` workflow validates at the pinned release, commits as the App with GraphQL `createCommitOnBranch` (`expectedHeadOid`) on `op/{operationId}`, opens the PR and enables auto-merge. `submit` also supports `abandon`. Retry and reconcile are fresh dispatches on `main`, never re-runs. Tokens are down-scoped per use. |
| D7  | PR checks are offline (schema, registry, catalogue, capacity, `terraform validate`); no Azure sign-in on PRs. Apply-time guards compensate. A PR plan with a read-only identity is later.                                                                                                                                                                                                                                                                                                                                                                                                                |
| D8  | `ai-platform-tenants`, `ai-platform-deployments` and the new `ai-platform-environments` are internal; `ai-platform-infra` and `ai-platform-workflows` stay public.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D9  | release-please from the start with the App token: infra tags `vX.Y.Z` and submits the pin for every registry entry with `autoPin: true` (infradev only in Phase 1); workflows tags `vX.Y.Z` and moves `v1`.                                                                                                                                                                                                                                                                                                                                                                                              |
| D10 | The deploy identity keeps its current subscription-wide roles; bootstrap adds only what is missing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D11 | Terraform with `azurerm`, `azapi` and `azuread` at exact versions with committed lock files; checks in Node.js 24 ESM (`ajv`, `vitest`, AICE standards); third-party actions pinned by SHA; `X-GitHub-Api-Version` pinned.                                                                                                                                                                                                                                                                                                                                                                               |
| D12 | Root modules `platform/` and `tenants/` (design B's `team/` root renamed); the catalogue tier name stays `team`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D13 | **Public code, private config**, as CDP keeps environment settings private: `ai-platform-infra` holds code, schemas, checks, catalogue and placeholder examples only; the registry and per-environment parameters (sizes, SKUs, flags, CDP issuer and AWS account, later address ranges) live in internal `ai-platform-environments`, written by platform engineers through reviewed PRs.                                                                                                                                                                                                                |
| D14 | Failure policy (design C): on `deploy-failed` the backend re-dispatches once; if it fails again and the run report attributes it to a team, the backend submits a revert (previous revision, or removal of a new file) as a system operation; unattributed failures alert engineers.                                                                                                                                                                                                                                                                                                                     |

## Environment progression

- A new environment is data: a registry entry and `platform.tfvars.json` in `ai-platform-environments`,
  a GitHub Environment, a deploy identity and a state account. No new repositories or workflow code.
- Tenants always apply at the environment's pinned release; platform promotion is a pin submission;
  tenant promotion is a generated file with `promotedFrom`; rollback is a new pin.
- **Gate before DEV:** rebuild infradev with the target private topology so it matches the consumer
  plan exactly (design D). Infradev holds synthetic teams only, so re-applying is safe.

## Target structure

```text
ai-platform-infra (public, human PRs, release-please)       code only
  platform/  tenants/  bootstrap/
  modules/ naming log-analytics key-vault apim foundry-account entra-api-audience
           team foundry-project foundry-deployment apim-team-api entra-team-app
  schemas/ team pin registry environment (.schema.json)
  checks/  validate, plan-guard, run-report (Node CLI and tests)
  catalogue/   examples/ (placeholder values only)
  docs/ gitops-contract.md bootstrap.md modules.md
ai-platform-environments (internal, platform engineers, CODEOWNERS)   config only
  registry.json   environments/infradev/platform.tfvars.json
ai-platform-workflows (public, release-please, callers use @v1)
  submit-desired-state, validate-*, apply-platform, apply-tenants, infra-checks, release,
  workflow-checks, prune-op-branches; composite actions
ai-platform-tenants (internal, App-written)       environments/infradev/{slug}.json
ai-platform-deployments (internal, App-written)   environments/infradev/platform.json
```

State: one storage account per environment (`staipinfradevtfstate`, shared key off), keys `bootstrap`,
`platform` and `tenants`, `azurerm` backend with Entra ID and OIDC. GitHub Environments in both state
repositories: `infradev` (deploy identity variables, `main` only) and `gitops-writer` (App secret,
`main` only, used by `submit` only).

## GitOps contract

Moves to `ai-platform-infra/docs/gitops-contract.md` with the schemas; this section is then replaced by
a link.

- Team file `environments/{env}/{slug}.json`: whole document, `schemaVersion: 1`, the design C fields,
  `additionalProperties: false`, `billingCode` nullable in v1, `updatedBy` an opaque ID, never a name or
  email; deterministic serialisation; under 60 KB (dispatch inputs are limited to 65,535 characters).
- Slug immutable, `^[a-z][a-z0-9-]{1,22}[a-z0-9]$`; file name equals `team.slug`; folder equals
  `environment`.
- Pin `environments/{env}/platform.json`: `release`, `sha`, `previousRelease`, `requestedBy`,
  `operationId`, `requestedAt`.
- Submit inputs: `action` (`write` or `abandon`), `environment`, `path`, `document`, `operation_id`,
  `expected_revision`, `requested_by`. Idempotent per operation; one open `op/*` PR per file; the PR is
  found by its head branch.
- Commit trailer `Operation-Id: {operationId}`; squash auto-merge; one environment per PR; required
  check `validate / {env}`, always run from `ai-platform-infra` at the pinned release.
- Apply: a superseded guard first (no Environment, so no Deployment record); the apply job is bound to
  Environment `{env}`, so GitHub records a Deployment at the applied SHA; one concurrency group per
  environment, no cancel; every platform apply for an environment runs in `ai-platform-deployments`.
- Schema evolution: expand and contract across two infra releases, with machine migration PRs.

| Signal                                                     | Operation state                             |
| ---------------------------------------------------------- | ------------------------------------------- |
| Submit run queued or running                               | `requested`                                 |
| Submit run failed validation (nothing written to Git)      | `checks-failed`                             |
| PR open on `op/{operationId}`                              | `pr-raised`                                 |
| `validate / {env}` failed, or PR closed unmerged           | `checks-failed` (backend submits `abandon`) |
| PR merged at `M`                                           | `merged`                                    |
| Deployment for `{env}` at `M` or a descendant, in progress | `deploying`                                 |
| …succeeded                                                 | `deployed`                                  |
| …failed with no later success, after the D14 policy        | `deploy-failed`                             |
| ARM reads confirm the resources                            | `verified`, then `active`                   |

## Robustness controls

| #   | Risk                                                       | Control                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A re-run applies an old SHA over newer state               | Re-runs reuse `GITHUB_SHA`, so retries are fresh dispatches and a superseded guard skips any run whose SHA is not the head of `main`                                                                                       |
| R2  | Unplanned destroys with no PR plan                         | Plan to a file and apply that file; `plan-guard` allows deletes only for teams or entries removed in the merged diff, none in platform, unless an engineer dispatches `allow_destroy`; `prevent_destroy` on core resources |
| R3  | One bad team blocks every team in the shared tenants state | D14 retry and attributed revert; the run report names the failing team                                                                                                                                                     |
| R4  | Concurrent PRs together exceed capacity                    | Checks run at submit, on the PR and again on `main` before every apply                                                                                                                                                     |
| R5  | Tenants applied ahead of the platform                      | The tenants apply reads the pin and runs only after the platform apply for that pin succeeded; the platform apply dispatches it                                                                                            |
| R6  | A stale state lease after a lost runner                    | Engineer-only `force_unlock` dispatch input, documented as break-glass                                                                                                                                                     |
| R7  | Blocked teams and branch litter                            | `abandon` closes failed PRs and releases the team lock; nightly prune of `op/*` branches older than 7 days                                                                                                                 |
| R8  | Tampered checks                                            | Checks from infra at the pin; the App has no Workflows permission; push rulesets limit it to `environments/**`                                                                                                             |
| R9  | Malformed data reaching providers                          | Terraform variable validation mirrors the schema                                                                                                                                                                           |
| R10 | Untested modules                                           | `terraform test` with mock providers; `examples/` reused as backend test fixtures                                                                                                                                          |
| R11 | Polling cost and rate limits                               | Conditional requests, a minimum interval, backoff on secondary limits, non-terminal operations only                                                                                                                        |
| R12 | Matching runs to operations                                | A run report artefact: applied SHA, operation IDs from trailers since the last success, change counts, failing team                                                                                                        |

## Workstreams

### WS0 Prerequisites and early verification

- Access: deploy identity roles, the bootstrap operator (Owner, or Contributor and User Access
  Administrator), the Graph identity, the Portal API identity's roles, resource providers registered.
- Azure: Defra Policy allows the names, public network access, Developer APIM and UK South; quota for
  the team model SKU (not Global, D03); `azurerm` or `azapi` for Foundry projects; OIDC token refresh
  during a long APIM create.
- GitHub: tenants and deployments internal; create internal `ai-platform-environments`; auto-merge,
  squash only, delete head branches; internal repositories may call `ai-platform-workflows`; App
  permissions (Contents, Pull requests and Actions write; Checks and Deployments read; no Workflows)
  on all five; App secrets for release-please and the `gitops-writer` Environments.

### WS1 Contract and configuration

- `ai-platform-infra` `v0.3.0`: scaffold and release-please; `team`, `pin`, `registry` and
  `environment` schemas with placeholder examples (key team `alpha`, OAuth team `beta`); the checks CLI
  (validate with an on-`main` mode, `plan-guard`, `run-report`); `team` tier and `infradev` on one or
  two cheap catalogue models; `docs/gitops-contract.md`.
- `ai-platform-environments`: `registry.json` (subscription alias, deploy identity, `cdp`, `writers`,
  `refs`, `resetNightly`, `autoPin`, `entra.enabled`, state location) and
  `environments/infradev/platform.tfvars.json`; CODEOWNERS; validate and apply callers.

### WS2 Bootstrap and Terraform (`ai-platform-infra` `v0.4.0`)

- Bootstrap: the state resource group, account and container; the deploy identity's federated
  credentials for `repo:DEFRA/ai-platform-tenants:environment:infradev` and
  `repo:DEFRA/ai-platform-deployments:environment:infradev`; missing roles only; `docs/bootstrap.md`.
- Platform modules: `naming`, `log-analytics`, `key-vault`, `apim` (system identity, logger,
  `aip-authorise` fragment, named values), `foundry-account` (APIM identity as Foundry User),
  `entra-api-audience` (toggle); Key Vault Secrets Officer for the Portal API identity on the tenants
  vault; `prevent_destroy`; `terraform test`; `docs/modules.md`.
- Team modules: `foundry-project`, `foundry-deployment` (`{slug}-{model}`), `apim-team-api` (`/{slug}`,
  operations per `apiProfile`, key or `validate-azure-ad-token` with the client list, 403
  `model-not-granted` outside `allowedDeployments`, `llm-token-limit`, managed-identity backend,
  access-window named value ignored by Terraform), `entra-team-app` (toggle; owners are the deploy and
  Portal API identities; ignores `account_enabled` and passwords); the `tenants/` root with variable
  validation; a hand-applied proof in an `adhoc-*` state.

### WS3 Reusable workflows (`ai-platform-workflows` `v1.0.0` and `v1`)

- Composite actions: OIDC login, pinned Terraform, down-scoped App token, checkout at the pin with a
  `minWorkflows` guard, superseded guard, checks setup, changed environments.
- `submit-desired-state`: validate at the pin, `createCommitOnBranch`, PR, labels, auto-merge,
  `abandon`, idempotency, concurrency per file.
- Apply guards (R1 to R6 and R12) wired into `apply-platform` and `apply-tenants`; validate workflows
  for tenants, pins and environments; `infra-checks`; `release` (registry `autoPin`);
  `workflow-checks`; `prune-op-branches`. Least `permissions`, `pull_request` only,
  `persist-credentials: false`.

### WS4 State repositories and the IaC proof without the backend

- Thin callers, rulesets (PR required, 0 approvals, required `validate / infradev`, App bypass, App
  limited to `environments/infradev/**`, branch creation App-only), the two Environments, a README with
  break-glass.
- Proofs: platform through release and pin with no manual step (M2); a key team through a scripted
  `submit` dispatch (M3); an OAuth team (M4); the guards R1 to R4 and R6 (M5).

### WS5 Backend submit and status adapter (this plan; `ai-platform-backend-api`)

- Shared GitHub App client extracted from `github-catalogue-source.js`, with down-scoped installation
  tokens.
- `tenant-orchestrator-registry.js` with `TENANT_ORCHESTRATOR=mock|github` (production refuses mock);
  config `GITOPS_TENANTS_REPO`, `GITOPS_DEPLOYMENTS_REPO`, `GITOPS_POLL_MIN_INTERVAL_MS` and
  `AIP_ENVIRONMENTS` (subscription, resource group, APIM, Foundry and tenants vault per environment); a
  contract test helper run against both adapters; the stale `tenant.bicep` comments fixed.
- `submitDesiredState` dispatches `submit.yml`, refuses documents over 60 KB and stores the submit run,
  branch, PR, merge SHA and apply run on the deployment entry; `requestDeployment` takes the WS6
  document and slug.
- The status poller follows the contract table, with a `TenantResourceVerifier` port (ARM adapter and
  mock), a sweep in the maintenance scheduler, audit on transitions and the R11 behaviour.
- Retry and reconcile as fresh dispatches for Platform Admins; the D14 failure policy; `abandon` on
  `checks-failed`.

### WS6 Teams developer hand-off

An immutable unique team `slug` (index and backfill per the schema-changes rules); `billingCode`
capture; configurable team environments including `infradev`, with the frontend option driven by the
backend; a desired-state builder producing schema-valid documents, tested against the `examples/`
fixtures at the pinned release; team credentials scoped to `/apis/{slug}` on the environment's APIM
from `AIP_ENVIRONMENTS` (Research keeps its hand-built API); the OAuth credential view.

### WS7 Documentation

- This plan, then the discovery-docs direction pull request, both before building.
- After the proofs: built state in discovery `build-stories.md#status`, and `implemented-features.md`
  where code changes.

## Milestones

1. M1 contract: infra `v0.3.0` and the environments repository, checks green.
2. M2 platform: an infra merge reaches SND1 through release-please and a pin with no manual step.
3. M3 key team: a synthetic team applies end to end; its key works; a non-granted model returns 403.
4. M4 OAuth team: registration and federated credential through GitOps; a token works; a foreign token
   is rejected.
5. M5 robustness: R1 to R4 and R6 proven.
6. M6 backend: a local Portal API with `TENANT_ORCHESTRATOR=github` reaches `active`; failures show
   links; retry, reconcile and revert work.
7. M7 portal: with WS6, a team created in the portal gets a working dedicated model credential.

## Out of scope

SND4 `sandbox`; the private topology (gate before DEV); a PR plan with a read-only identity; merge
queue; nightly reconcile, Infradev reset and ad hoc clean-up; Infradev candidate SHA pins; deletion
cooling-off; promotion from the portal; break-glass detection in the poller; the Research tier under
IaC; the three-App split; organisation rulesets; CDP Web Identity for the backend.

## Risks

- Defra Policy may deny public network access or the names in SND1; checked first.
- A Developer APIM create is slow; OIDC refresh is verified first.
- Key Vault purge protection reserves names for 7 days after a destroy.
- Phase 1 has one App: its key sits in the backend, the `gitops-writer` Environments and the release
  secrets; down-scoped tokens limit each use until the three-App split.
- Dispatch inputs are visible to repository readers: never secrets or personal data.
- The deploy identity is subscription-wide in a shared sandbox subscription (accepted, D10).

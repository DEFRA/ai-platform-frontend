You are taking over the AI Platform IaC baseline (Defra). Goal: get the Terraform pipelines applying Infradev

through GitHub Actions, then build create-platform, create-tenants and trigger-from-UI on top.

Read first (ai-platform-discovery-docs, branch docs/iac-baseline-decisions, PR #21): docs/iac-baseline-plan.md

(D1-D16, WS0-WS7, M1-M7, R1-R12), docs/decision-history.md (14 and 15 October entries), and the design pages

design-environments, design-repositories-pipelines (#workflows), design-orchestration, design-identity,

design-infrastructure. Then ai-platform-infra docs/bootstrap.md, docs/gitops-contract.md and docs/modules.md,

and ai-platform-workflows README.md.

Repos and branches (all pushed, stacked, none merged): ai-platform-workflows feature/reusable-workflows #1;

ai-platform-infra #5 feature/gitops-contract -> #6 feature/platform-baseline -> #7 feature/tenant-modules

(squash-merge in order, rebase the next after each); ai-platform-environments feature/registry-infradev #1

(draft); ai-platform-tenants and -deployments feature/gitops-callers #1; ai-platform-backend-api #35;

ai-platform-frontend #35; discovery-docs #21.

CURRENT STATE (15 Oct 2026). Applied BY HAND (engineer sign-in) and ONLY inside resource group

SNDAIEAIPRGP1401 in AZR-AIE-SND1 (7f8da4be-7fd1-469f-a34f-fe89fa5d24d2): bootstrap state in

sndaipinfsto1401/tfstate (key bootstrap.tfstate) and platform state (key platform.tfstate). The platform is

APIM Developer, a UK South Foundry account, two Key Vaults, Log Analytics, App Insights, the aip-authorise

fragment and diagnostics; plans show no drift. Release tag on resources is manual-c195d26. The deploy identity

is the existing app registration APP-AIE-SND1-aice-platform-gha-01 (client 14c56e2d-6983-480e-99db-71b66ebd5f88,

SP c9fe7861-6d1d-43d4-9950-49c21abc425c). It has federated credentials for the tenants and deployments repos,

Environment infradev, and Contributor plus a constrained RBAC Administrator on that RG ONLY, plus Storage Blob

Data Contributor on the state container. Entra is OFF (entra_enabled=false): there is no API audience and no

team registration, and I cannot create app registrations. Never touch anything outside that RG; confirm every

apply with the owner first.

TO DO TO RUN THE PIPELINES (nothing below exists yet; GitHub has no Environments, variables or secrets):

1. Merge workflows #1, then create the v1 tag (README, Releases). Infra and environments CI cannot start

   without it.

2. Merge infra #5, #6, #7 in order; let release-please cut an infra release; set the infradev pin in

   ai-platform-environments registry.json to it, replace the placeholders (aip-checks environments

   --reject-placeholders must pass), then merge environments #1.

3. ai-platform-tenants and -deployments are PUBLIC; they must be internal before any apply (apply logs show

   resource IDs). Needs an org admin. Then merge their callers (#1).

4. Run the repo-settings script (session files/gitops-setup/apply-repo-settings.ps1, runbook C2): rulesets,

   Environments infradev, gitops-reader, gitops-writer, gitops-dispatch, release.

5. Set variables: repo AZURE_TENANT_ID (770a2450-0227-4c62-90c7-4e38537f1102) and GITOPS_APP_CLIENT_ID; Environment

   infradev (tenants and deployments) AZURE_CLIENT_ID=14c56e2d-6983-480e-99db-71b66ebd5f88 and

   AZURE_SUBSCRIPTION_ID. Secret GITOPS_APP_PRIVATE_KEY (GitHub App ai-platform-orchestrator) in gitops-reader,

   gitops-writer, gitops-dispatch and release. Install the App on the repos.

6. Dispatch apply.yml in ai-platform-deployments (state platform, environment infradev). EXPECT: no resource

   changes, an aip-release tag update (manual-c195d26 to the release), and the Key Vault role deploy-secrets-officer

   moving from the engineer to the deploy SP. Anything else is a bug: stop and investigate.

7. Then tenants: it needs Entra, so it is blocked until the owner has an Entra role to create app registrations

   and consent to Graph Application.ReadWrite.OwnedBy for the deploy and backend identities (plan D4/D12A). Until

   then UI -> API -> submit -> PR -> validate -> merge can be tested, but not the tenants apply.

LOCAL WORKFLOW. Generate parameters with `node checks/bin/aip-checks.js params --infra . --environments

../ai-platform-environments --environment infradev --out <file>`; use it with `terraform -chdir=platform plan

-var-file=<file> -var release=<x> -var entra_enabled=false`after`init -backend-config=resource_group_name=...

storage_account_name=sndaipinfsto1401 container_name=tfstate key=platform.tfstate`, with ARM_SUBSCRIPTION_ID set

and ARM_USE_AZUREAD=true. Bootstrap: backend.tf is committed commented out; uncomment locally only (never commit

it), run init -migrate-state per docs/bootstrap.md. The owner's state access is still on (operator_state_access);

set it false when the pipeline is proven. Tests: Windows needs the Git bash for AIP_TEST_BASH and tools on PATH;

infra Terraform checks run via ai-platform-workflows/scripts/infra-checks.sh.

RULES: GitOps by default; the backend never commits (dispatch -> validate -> App commit -> PR -> auto-merge).

Parameters are namespaced under azure.*, merged only by aip-checks params. Team tier is OAuth only (Research

tier keeps its time-bound subscription keys). Names come from the naming module, never hard-coded. Public repos

(infra, workflows) hold no real tenant, subscription or app IDs. No secrets in state or inputs. Every bug fix

ships with a failing-then-passing test. Conventional commits with the Copilot Co-authored-by trailer; branches

and PRs only; format, lint and tests pass before every push; never --no-verify.

KNOWN OPEN ITEMS: Sweden Central is refused by the DEFRA Allowed locations policy (Infradev is UK South only),

so the team proof (M3) needs a model deployable there or a policy exception; a shared mailbox for the APIM

publisher (currently a personal address); the Entra 250 created-objects limit; D10 is corrected to RG-scoped

Contributor; backend and frontend PRs now include another developer's commits (slugs, service code, the WS6

desired-state builder): run their tests and check the builder's team file against ai-platform-infra

schemas/team.schema.json; nightly drift plan stays at the gate before DEV; the Key Vaults have purge protection,

so their names are held for 7 days if deleted.

Notes from the handover:

Infradev is bootstrapped and its platform is applied, by hand and only inside SNDAIEAIPRGP1401. The full summary and the developer handover prompt are in this file just above this message. The GitHub side isn't set up yet, so your developer (the one taking over from the handover) can't run the TF pipelines until the ordered steps in the handover are done. I haven't run any GitHub Actions workflow.

Pushed: every IaC change is committed and pushed, and no Copilot review threads are unresolved.

Infra #5 030182d, #6 72d672f, #7 440274c.

Environments 6d79b67.

Docs 4cd4b16.

Backend cfcc6d1 and frontend 5f84ef6, both with the developer's(frontend and backend changes that are commited already) commits pulled in.

Verified: the platform plan shows no changes, and the bootstrap plan shows none either. The deploy identity now holds Contributor and a constrained RBAC Administrator on the one RG, plus the state-container role, and both federated credentials exist. The Terraform tests, 206 checks tests and 547 site tests pass.

CI: infra and environments checks can't start until the workflows v1 tag exists. Docs CI was still running at the last check.

Still on: your state-container access, which a manual apply needs. Turn it off with operator_state_access=false once the pipeline is proven.

Not done: I didn't run the developer's backend or frontend tests, or check their team builder's output against the infra team schema.

Next steps: the handover lists them in order: merge workflows #1 and create the v1 tag, merge the infra PRs and pin the release in environments, make tenants and deployments internal, then set up the Environments, variables and secrets. After that, dispatch the platform apply.

# Research tier in Infradev: platform IaC and the portal move

> Cross-cutting plan, not a journey route. See also
> [build-stories-delivery-plan.md](build-stories-delivery-plan.md) and
> [iac-rollout-state.md](iac-rollout-state.md), and the two implemented cross-cutting plans,
> [research-tier-integration-plan.md](../implemented/integration/research-tier-integration-plan.md)
> (what the research tier is today) and
> [centralised-gateway-plan.md](../implemented/centralised-gateway/centralised-gateway-plan.md).
>
> **STATUS: NOT STARTED (19 Oct 2026).** Nothing here is built. The research Foundry project, the
> research deployments and the `research` API do not exist in any environment's IaC. Update the
> `Status` line on each phase as it lands and add a dated note at the bottom recording what
> actually happened versus what is written here.

## Why

The research tier works, but only against resources somebody built by hand in a different
resource group. The portal points at `SNDAIEEXPRGP1401`, API Management `DEPLOYTESTDEFRA`, Key
Vault `kv-aip-sandbox-tenants` and Foundry `sndaieinfst1401aiefoundry`. None of that is in
Terraform, none of it is reproducible, and it is not where the platform now builds: Infradev's
platform state applies into `SNDAIEAIPRGP1401` and has its own API Management, Foundry account,
Key Vaults and diagnostics.

Meanwhile the team tier has proved the IaC path end to end — a team file submitted by the portal
reached a Foundry project, a model deployment and an API Management API in Infradev on 15 October 2026. The research tier should now follow the same path.

The goal is that a person signs in to the portal, creates a research credential for a model, and
calls Infradev's gateway with it, with every Azure resource behind that created by Terraform. The
team tier, in the same release, requests a model, watches an honest progress page, and receives a
credential that is openly labelled a placeholder until Entra consent lands.

Research tier is production-only in the target design. Infradev is where it is proved.

## Authoritative source

| Reference                                                                                                                 | What it mandates                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [design-orchestration.md](../../../../ai-platform-discovery-docs/src/content/design-orchestration.md)                     | Subscription keys belong to the research tier, whose `research` API requires a subscription and whose subscriptions are the backend's; API Management products are not used; the key guard runs only for that API                            |
| [AR diagram, model access enforcement](../../../../ai-platform-discovery-docs/src/diagrams)                               | Deployments are **account** children visible to every project; a project is not a model boundary; the team API at the gateway is the boundary; the `research` API is generated from a **platform-owned team file** naming `subscription-key` |
| [design-identity.md](../../../../ai-platform-discovery-docs/src/content/design-identity.md)                               | Research credentials are limited, scoped and last at most a week, with a small fixed renewal count; the team tier is OAuth only (14 October 2026)                                                                                            |
| [design-environments.md](../../../../ai-platform-discovery-docs/src/content/design-environments.md)                       | The environment list, Infradev as the platform's own control-plane copy, and the Phase 1 progression                                                                                                                                         |
| [design-infrastructure.md](../../../../ai-platform-discovery-docs/src/content/design-infrastructure.md)                   | The resource inventory per environment, CCoE naming, and the sentence this plan supersedes: that the Infradev research proof uses an existing API Management instance with a public hostname                                                 |
| [docs/decision-history.md](../../../../ai-platform-discovery-docs/docs/decision-history.md)                               | Direction in force, and the 13 to 18 October entries on naming, full specification, team tier and gateway policy layering                                                                                                                    |
| [ai-platform-infra `docs/modules.md`](../../../../ai-platform-infra/docs/modules.md)                                      | The module contract, and that `aip-key-guard` is for "the Research tier, when it arrives"                                                                                                                                                    |
| [schema-changes.instructions.md](../../../../ai-platform-backend-api/.github/instructions/schema-changes.instructions.md) | How a new persisted field is added and backfilled                                                                                                                                                                                            |

## What exists today

| Piece                                  | State on 19 Oct 2026                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aip-key-guard` policy fragment        | Built in `modules/apim`; the global policy already branches on `aipCredentialType` `key`. No API declares it                                                         |
| Catalogue research markers             | `tiers` and `deploymentName` are in `catalogue/schema/model.schema.json` and the model records; a `skus[]` entry without `tiers` is research                         |
| `gateway.credentialType`               | **`oauth` only.** `schemas/team.schema.json` rejects `subscription-key`, `tenants/variables.tf` has a validation refusing it, and `schemas.test.js` pins the refusal |
| `modules/apim-team-api`                | Hardcodes `subscription_required = false` and `aipCredentialType` `oauth` in both the API and its policy, and the metric dimension                                   |
| Research project, deployments, API     | **Do not exist in any environment.** No `research` team file exists either                                                                                           |
| Portal API rights on the Infradev APIM | **None.** It holds Key Vault Secrets Officer on the tenants vault and nothing else                                                                                   |
| Backend research configuration         | Flat `armAuth.subscriptionId`, `armAuth.resourceGroup`, `apim.serviceName`, `keyVault.vaultName` — one hand-built environment                                        |
| Research credential `environment`      | Not persisted. `src/routes/credentials.js` has `Joi.forbidden()` for the research tier                                                                               |
| `AIP_ENVIRONMENTS`                     | Already carries subscription, resource group, API Management name, Foundry accounts and tenants vault per environment; used only by the team-deployment ARM verifier |

## The shape the design requires

The design pack's model-access diagram and the platform engineer's answers on 19 October 2026
settle four things this plan must follow:

1. **Deployments are account children, not project children.** They are visible to every project;
   any project sees every deployment. A project groups agents, files and evaluations and **is not
   a model boundary**. The research project is simply a shared project inside the Foundry account,
   beside each team's. The account/project split here is provisioned throughput versus managed
   compute dedicated to a project, and the platform does not use the latter yet — so there is no
   reason to push a deployment down into a project, and no access control to be had by doing so.
2. **The API at the gateway is the boundary.** Access is decided by the API's policy and its
   `allowedDeployments` allow-list, never by project membership.
3. **The `research` API is generated from a platform-owned team file** naming
   `credentialType: subscription-key`. Research is modelled as a team called `research` that the
   platform owns, not as a bespoke parallel stack. One credential, one type: the file names the
   type and the API is generated to match.
4. **The research path is the official spec's path, passed straight through — no translation.**
   The caller sends the deployment name in the URL exactly as the imported Azure OpenAI spec
   defines it, and the gateway forwards it. This is a deliberate departure from the team tier,
   where the caller sends a catalogue slug and the policy maps it to the derived `{slug}-{model}`:
   translation buys a team its per-team deployment names, and buys research nothing but
   complication. The research tier is static — a fixed URL and a pre-determined list of models,
   and people simply get keys to it.

   The consequence is that a research deployment's Azure name **is** part of the public contract,
   so it is written in the research file and carried in the catalogue's `deploymentName`, rather
   than derived. That is a deliberate exception to "no resource names in a team file" (direction
   2, 14 October 2026), which exists to stop a team pinning its own resource names; the
   platform-owned research file is the one place the name is the interface.

That makes this a much smaller, more modular change than a second API builder: extend the schema
and the existing `apim-team-api` module to handle `subscription-key`, then commit a
platform-owned `research.json`. It also explains why `aip-key-guard` and the global policy's `key`
branch were built already and left unused.

A shared research deployment may later be granted to a team, which is how a team API comes to list
a deployment it does not own; that grant mechanism is designed but out of scope here.

## How it is triggered

The portal never triggers research infrastructure, and it should not be made to. Research and a
team share a pipeline but not an author:

| Tier     | Infrastructure                                                                                             | Credential                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Team     | **Portal** dispatches `submit.yml`, which writes the team file; the merge triggers the tenants apply       | The backend, through Microsoft Graph (mocked until Entra consent) |
| Research | **An engineer** commits the platform-owned `research.json`; the same validation and tenants apply build it | The backend, calling ARM directly                                 |

So the research project, its deployments and the `research` API are built by the tenants apply,
from a file no portal path may write. Adding a research model later is an edit to that file — or a
catalogue change, a release and a pin where the catalogue is what changed — and then an apply.
Infradev has `autoPin: true`, so an infra release submits the pin by itself; set it `false` if
every apply is to be dispatched by hand through `apply-state.yml`.

Creating a research credential involves no Terraform at all: the backend creates an API Management
subscription against the already-existing `research` API through ARM and calls `listSecrets`. That
is why R1 forbids Terraform from owning a subscription — it would fight the backend on every
apply.

The one coupling: a catalogue model marked research-eligible whose deployment has not been applied
will issue a key happily and then fail at the gateway, because the policy routes to a deployment
name that does not exist. R1.6's checks are what keep the pair honest.

## Pipeline ordering

The order is explicit and nothing in this plan may blur it:

**Bootstrap (one-off) → Platform IaC pipelines → Portal orchestration and tenant pipelines.**

What sits where:

- **Platform layer** — API Management, the Foundry account, the named backends, the global policy
  and the custom API Management role and its assignment. The role cannot live in bootstrap,
  because it is scoped to an API Management instance that does not exist until the platform
  applies.
- **Tenant layer** — the research project, its account-child deployments and the `research` API,
  built from the platform-owned `research.json`, alongside every team file. Platform-owned does
  not mean platform-state: it means an engineer authors it, not the portal.
- **Portal** — never creates a research resource at all. It mints subscriptions against an API the
  tenants apply has already built.

R1 and R2 are therefore complete before R3 points the portal at anything.

## Prerequisites

| #   | Prerequisite                                                                                                              | Owner       | State on 19 Oct 2026                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Who owns the custom API Management role (R1.5)                                                                            | Platform    | **Answered: Terraform owns it.** The deploy identity already holds User Access Administrator, so it can create the definition. It must be idempotent |
| 2   | Research capacity per model                                                                                               | Platform    | **Answered: as low as the design allows for now.** Minimum viable capacity, raised deliberately later                                                |
| 3   | Entra admin consent for `Application.ReadWrite.OwnedBy` (already tracked in [iac-rollout-state.md](iac-rollout-state.md)) | Entra admin | Open; blocks R5's removal only                                                                                                                       |

Prerequisite 3 does not block this plan. The team credential stays mocked until it lands; that is
R5, and its removal is Phase 5 B18 of
[build-stories-delivery-plan.md](build-stories-delivery-plan.md).

---

## Phase R0 — Design and decisions

**Status: not started.** Repository: `ai-platform-discovery-docs` only. No dependencies — runs in
parallel with R1.

1. Supersede the sentence in `design-infrastructure.md` that the Infradev research proof uses an
   existing API Management instance with a public hostname and no injection. The instance is now
   the platform's own; public access remains a Phase 1 concession, which is a separate statement.
2. Record that the research tier is a platform-owned team file in `design-orchestration.md`
   `#resource-model` — the same project, account-child deployments and generated API as a team,
   differing only in who authors the file and that it names `subscription-key`. The model-access
   diagram already shows this; the prose should not imply a parallel stack.
3. State in `design-environments.md` that the research tier is environment-aware, lives in
   Infradev for the proof, and is production-only in the target.
4. Confirm in `design-identity.md` that research is subscription key only and the team tier is
   OAuth only — no change of direction, but the pages should not be ambiguous after this work.
5. The model-access diagram is marked `Proposal · unimplemented`. Move it to implemented when R2
   applies, not before, and follow the repository's AR record rules if its state is held in
   `src/data/cloud-designs.json` — bump `version`, append a dated `history` entry, advance
   `reviewedOn`.
6. Append a dated `docs/decision-history.md` entry with a `Topic | Direction | Site consequence`
   table naming every page changed, and update the "Direction in force" rows it decides.
7. Re-date every Markdown file touched, pin the new copy in `test/site.test.js` with an
   `assertCopy`, and add `assert.doesNotMatch` for the superseded wording.

**Verify:** `npm run lint`, `npm test`, `npm run check`.

---

## Phase R1 — Research tier IaC

**Status: not started.** Repository: `ai-platform-infra`. Blocks R2. Items 1 to 4 extend the
tenant layer; item 5 is platform layer.

The work is to teach the existing team stack one new credential type, not to build a second one.

1. **Allow `subscription-key` as a `gateway.credentialType`.** Three places refuse it today:
   `schemas/team.schema.json`, the validation in `tenants/variables.tf`, and
   `checks/tests/unit/schemas.test.js`, which pins the refusal. Replace the blanket refusal with
   the real rule: `subscription-key` is permitted only for the platform-owned `research` file, and
   a team file is still OAuth only (direction 14 October 2026). The check should name the file, so
   a team cannot acquire a key by editing its own file.
2. **Parameterise `modules/apim-team-api` on the credential type.** It hardcodes
   `subscription_required = false` and `aipCredentialType` `oauth` in the API, the policy and the
   metric dimension. Drive all four from the input so a `subscription-key` file produces an API
   that requires a subscription and declares `key` — which makes the global policy run the
   `aip-key-guard` that was built for this and has never been reachable. The seven-step inbound
   order, the fragments and the token metric are unchanged; the guard replaces the token check, it
   does not add a second path. **Terraform creates no `azurerm_api_management_subscription`** —
   those are the backend's, minted per person. Say so in a comment so nobody adds one later.

   Two deliberate differences from the team case:
   - **No model translation.** The team path runs `aip-request-model` to map a catalogue slug to
     the derived `{slug}-{model}`; the research path skips it and forwards the deployment name the
     caller sent, as the imported spec defines it. The allow-list is still enforced — step 4 of
     the inbound order checks the raw deployment name against `allowedDeployments` and refuses
     with `model-not-granted` before any backend call.
   - **The `llm-token-limit` counter is keyed by the caller's subscription**, not by the API, so
     each person has their own allowance (design C `#model-access`). A team's limit stays keyed by
     the API.

3. **The platform-owned `research.json`**, committed by an engineer to
   `ai-platform-tenants/environments/infradev/`, with `credentialType: subscription-key`,
   `allowedDeployments` listing the approved deployment names and `deployments[]` carrying each
   one's name, SKU and capacity. Unlike a team file it does carry the Azure deployment names,
   because on this API the name is the public contract — see point 4 of the shape above. Add it to
   `examples/` as a fixture, and allow the names only on this file.

   `text-embedding-ada-002` stays out — it is `eligible: false`. Start at the lowest capacity the
   design allows and raise it deliberately: deployments are account children drawing on the same
   pooled TPM as every team deployment of that model, and the PR checks sum them against the
   environment's `capacityPolicy` quota.

4. **The project is a shared project, not a model boundary.** `aip-research` is created by the
   existing `foundry-project` module as the research "team's" project — nothing new. The
   deployments are account children visible to every project, and nothing in this plan may use
   project membership as an access control; the API's allow-list is the boundary. Project-scoped
   managed compute is what would make a project a boundary, and the platform does not use it. The
   module's display name reads "AI Platform team research" — either accept that or add an optional
   display-name override, but do not
   restructure the module for it.
5. **The API Management permission gap.** The backend mints a research key by `PUT`ing an API
   Management subscription through ARM and then calling `listSecrets`. On the Infradev instance
   the Portal API principal has no API Management role at all, so this is a blocker, not a detail.
   No built-in role grants subscription management alone; the narrowest, API Management Service
   Contributor, is full control of the gateway including the policy that enforces the research
   tier, so it is not the answer.

   Build a custom role definition with exactly the actions the adapter calls — verify each against
   `az provider operation show --namespace Microsoft.ApiManagement` before the first apply:
   - `Microsoft.ApiManagement/service/read`
   - `Microsoft.ApiManagement/service/subscriptions/read`, `/write`, `/delete`
   - `Microsoft.ApiManagement/service/subscriptions/listSecrets/action`, for the reveal
   - `Microsoft.ApiManagement/service/subscriptions/regeneratePrimaryKey/action` and
     `regenerateSecondaryKey/action`, for the rotate

   No `apis`, `policies` or `products` actions, and no `NotActions`.

   Two Azure constraints shape it. `assignableScopes` cannot name an individual resource, so the
   **definition** is scoped to the platform resource group and the **assignment** to the API
   Management resource id, with `principal_type = "ServicePrincipal"` on
   `var.azure.identities.portal_api_principal_object_id` — the pattern the `key_vaults.tenants`
   block already uses.

   **Terraform owns both** (answered 19 Oct 2026): the deploy identity holds User Access
   Administrator, so it can create the definition as well as the assignment. API Management
   Service Contributor is rejected; if it is ever used to unblock a demonstration it goes in as a
   named exception with an owner and an end date, the way X1 to X3 do, never as a silent default.

   **It must be idempotent**, because the platform applies repeatedly and the state may be rebuilt:
   - Give `azurerm_role_definition` an explicit deterministic `role_definition_id`, derived from
     the environment (`uuidv5`), not an Azure-generated one, so a re-create reuses the same id
     rather than orphaning the old role.
   - A custom role name is unique per tenant, so carry the environment in it.
   - Give the `azurerm_role_assignment` a deterministic `name` too, so a repeat apply is a no-op
     rather than a duplicate or a conflict.
   - Role definitions propagate before they can be assigned. If the first apply races, make the
     wait explicit rather than relying on a retry.

   The role still permits a subscription scoped to any API, so the compensating control is in R3:
   the backend always scopes to the research API, and the maintenance sweep flags any subscription
   that is not named `research-*` or is scoped elsewhere.

6. **Monitoring and logging.** The research API inherits the instance's W3C diagnostics and the
   LLM gateway log the team APIs already emit. Confirm no request or response body is logged and
   that prompt capture stays off, and add the API wherever a dashboard or alert enumerates APIs.
7. **Checks.** Extend `checks/src` to reconcile the research file's `deployments[]` and
   `allowedDeployments` against the catalogue's research-eligible models **and their
   `deploymentName`** — a mismatch there is a broken endpoint for every caller, since nothing
   translates. Also: keep the per-account deployment count inside Azure's limit of 32 now that
   research and team deployments share an account, sum research capacity into the `capacityPolicy`
   quota with every team's, and refuse `subscription-key`, and an explicit deployment name, on any
   file but the research one.
8. **Terraform practice throughout:** validated inputs, minimal outputs, no secret in a state
   output, `prevent_destroy` where the platform rules already require it, checkov clean, and the
   fixture from item 3 under `examples/`.
9. Release through release-please and record the version here.

**Verify:** `terraform validate` and the module tests; `aip-checks` passes; the existing team-API
tests still assert `oauth` and a new one asserts the `key` branch; a plan against Infradev shows
additions only.

---

## Phase R2 — Apply to Infradev

**Status: not started.** Repositories: `ai-platform-environments`, `ai-platform-deployments`,
`ai-platform-tenants`. Depends on R1. Must complete before R3 points the portal at anything.

1. Pin the new infra release in `environments/infradev/platform.json` so the platform carries the
   schema and module changes, then commit `research.json` to
   `ai-platform-tenants/environments/infradev/`. `entra.enabled` stays `false` and the
   `entra.teamRegistrations` interim flag stays as it is — research needs neither.
2. The platform apply runs first, then the tenants apply builds the project, the deployments and
   the `research` API. To keep every apply manual, dispatch `apply-state.yml` with the `state`
   input and set Infradev's `autoPin` to `false` so a release does not submit the pin behind you.
3. **Never apply without owner confirmation.** Expect plan-guard to stop only on a delete. Check
   the plan specifically for two things: that parameterising `apim-team-api` does not force a
   replacement of the existing `cool-team` API, and that research capacity leaves the environment
   inside its pooled quota.
4. Record the resources actually created, by name, in [iac-rollout-state.md](iac-rollout-state.md).

**Verify:** the research project, its deployments and the `research` API exist in Infradev; a key
minted by hand against the API returns a completion; no drift on a second apply, and the custom
role and its assignment are untouched by it.

---

## Phase R3 — Backend: environment-aware research tier

**Status: not started.** Repository: `ai-platform-backend-api`. Code may be written in parallel
with R1; it lands after R2.

1. **Configuration.** New `research.environment` (`RESEARCH_ENVIRONMENT`). Resolve the
   subscription, resource group, API Management name and vault for the research tier from the
   existing `AIP_ENVIRONMENTS` entry for that environment, not from `armAuth.subscriptionId`,
   `armAuth.resourceGroup`, `apim.serviceName` and `keyVault.vaultName`. `armAuth` keeps
   authentication only — tenant, client, auth method, federated audience. A startup guard refuses
   to boot in live mode when the named environment is missing from `AIP_ENVIRONMENTS` or has no
   API Management name or tenants vault.
2. **Adapters take the resolved settings as parameters.** `apim-credential-issuer.js` and the
   vault registry stop reading the flat configuration themselves, so the environment is injected
   rather than assumed. The subscription scope and the vault name come from the environment.
3. **Persist `environment` on a research credential.** Relax `src/routes/credentials.js` so
   `environment` is optional for the research tier and defaults to the configured one; the team
   rule is unchanged. Widen the hardcoded `('infradev', 'sandbox')` enum to the registry-shaped
   pattern `team-deployments.js` already uses, gated by configuration.
4. **Backfill** `2026-10-dd-research-credentials-environment`, an aggregation-pipeline
   `updateMany` setting `environment: 'sandbox'` on existing research credentials only — they were
   issued against the hand-built resources. Read defensively until it has run everywhere.
5. **Vault tags** carry the credential's environment, not `cdpEnvironment`.
6. **Deployment names stay as they are.** The research path does not translate, so the deployment
   name the caller puts in the URL is the one Azure holds, and the catalogue's `deploymentName`
   remains the right field for it — keep it, and keep `gateway-request.js` building the same
   endpoint shape. What must be true is that `deploymentName` matches the research file's
   `deployments[]` exactly, in both directions: that is R1.7's check, not a runtime concern. Bump
   `CATALOGUE_REF` if any record changes.
7. **Every lifecycle path follows the same resolution**, and the maintenance sweep reads the
   credential's own `environment` rather than configuration — so a credential issued in a previous
   environment still revokes correctly. **This is the migration seam**: moving the research tier
   to another environment later becomes a configuration change plus natural expiry, not a data
   migration.
8. **The compensating control from R1.5:** the sweep flags any API Management subscription that is
   not named `research-*` or is scoped outside the research API.
9. **Tests:** extend the shared `credential-issuer-contract.js` suite, nock the new ARM paths, test
   the backfill both ways, and test that a live-mode issue against a missing environment fails
   closed.

**Verify:** a research credential issued, revealed, rotated and revoked against Infradev, with
`issuerKey` proving it was not mocked; the key calls the gateway and returns a completion.

---

## Phase R4 — Frontend: environment-aware gateway and copy

**Status: not started.** Repository: `ai-platform-frontend`. Depends on R3.

1. Replace the single `gateway.baseUrl` default `https://deploytestdefra.azure-api.net` with a
   per-environment base URL, plus `RESEARCH_ENVIRONMENT` so the samples show the right host.
   `gateway.researchApiId` is unchanged.
2. `gateway-request.js` takes the environment and builds the Infradev URL; the `code-examples`
   snippets follow.
3. The copy stops saying Sandbox — `connect/controller.js` ("A key that lasts 7 days in Sandbox")
   and `home/index.njk` ("in the Sandbox environment") read from `environment-names.js` and the
   configured research environment.
4. The research connect journey, `/models/{slug}` and `/manage/credentials/{id}` each say which
   environment the key works in.

**Verify:** a person copies the sample from the portal, runs it unedited and gets a completion.

---

## Phase R5 — Team credential: a labelled placeholder

**Status: built 19 Oct 2026, not yet seen live** (see the dated note). Repositories: frontend, backend. Independent of R1 to R4, but a team
reaches it only once R6 lets a deployment finish verifying.

Until the Entra consent lands there is no team registration to add a client secret to, so the
Graph call B18 will make cannot be made. `live` mode answers `501 gateway-not-enabled` today.
Rather than leave the journey broken, mock **only that step** and keep everything else real, so
the whole thing can be demonstrated end to end and the pages genuinely show a credential.

1. `MOCK_TIERS=team` keeps the journey completable. The mock issuer stands in for the Graph
   `addPassword` call and nothing else: the same `CredentialIssuer` port, the same
   `credential-service.js` path, the same one-credential-per-team-per-environment rule, the same
   vault write, the same one-time reveal, the same pages. When B18 lands, the adapter changes and
   none of the rest does — which is the point of mocking at the port.
2. **Research is untouched and stays live.** The vault registry routes by the credential's
   `issuerKey`, not by the provisioning mode, so a mock-issued team secret goes to the mock vault
   while research credentials keep going to the real Key Vault in the same run. No fake secret is
   ever written into the real vault, and the two tiers can be demonstrated side by side.
3. **The mock vault is an in-memory `Map`**, so a secret does not survive a backend restart and
   the one-time reveal will find nothing afterwards. That is acceptable within a single demo run;
   if the demo must survive a restart, persist the mock vault rather than discovering this live.
4. The credential page, the `/manage` row and the wait page carry one shared inset saying this is
   a placeholder that will not authenticate against the gateway yet, and why. One component, not
   three copies of the words. It says the credential is not yet usable — it does not hide it.
5. The placeholder wording is removed when B18 lands — the Graph issuer that adds a real client
   secret to the team's own registration. That trigger, and the issuer's shape, are in Phase 5 of
   [build-stories-delivery-plan.md](build-stories-delivery-plan.md) so it is not left behind.

**Verify:** a team journey completes and shows a credential with its key hint on `/manage`; the
inset appears wherever a mocked team secret does, and a test fails if a mocked secret is rendered
without it; a research credential issued in the same run still reaches the real Key Vault.

---

## Phase R6 — Make verification finish, and show what it verified

**Status: built 19 Oct 2026, not yet seen live** (see the dated note). Repositories: backend, frontend. Depends on Phase 4 of
[build-stories-delivery-plan.md](build-stories-delivery-plan.md).

A team's resources are created in Azure and the page still says it is setting them up. The cause
is a silent failure, not a slow one.

`verifyDeployed` in `github-tenant-orchestrator.js` calls the verifier and keeps only
`{ verified }` — it **discards the `reason`**. When verification does not pass it returns
`{ status: 'deployed' }`, which is the status the entry already had, so `persistStatus` sees no
change, writes nothing, and the next poll repeats it. The entry re-verifies every
`GITOPS_POLL_MIN_INTERVAL_MS` **for ever**, and nothing anywhere records why. `deployed` is in
`NON_TERMINAL_STATUSES`, so the page keeps showing progress, and `verified → active` — the step
that would add the model to `gateway.allowedDeployments` and let a credential be issued — is never
reached. A credential request meanwhile fails `409 deployment-not-ready`.

`arm-tenant-resource-verifier.js` already returns a precise reason for each case:
`environment-not-configured` (the environment is missing from `AIP_ENVIRONMENTS`), `no-resources`,
`resource-outside-environment`, `unsupported-resource-type`, `resource-unavailable` and
`resource-not-succeeded`. The first is the likeliest here and is pure configuration — and it is
invisible today.

1. **Keep the reason.** `verifyDeployed` returns it; `persistStatus` writes it to the entry as a
   verification failure, with an attempt count and the time of the last attempt.
2. **Make repeated failure terminal.** After a bounded number of attempts the entry moves to a
   failure status rather than re-verifying for ever, with the stable reason on it. An engineer can
   retry through the existing admin `retry`/`reconcile` route. Decide the bound and record it.
3. **Audit every failed verification**, and log the reason — this is exactly the signal that was
   missing.
4. **Surface it.** The wait page and the team page say verification failed and what to do, using
   R7's honest labels — never "setting up" for something that has stopped.
5. **Then show the list.** `gitops.resources` is the team's entry from the run report's
   `outputs.teams.value`, and the verifier already walks it. Return it on the deployment document
   — name, kind, verified — and render it as a summary list once the deployment is active, with an
   explicit "app registration skipped, awaiting Entra consent" line derived from the environment's
   `entra.enabled` and `entra.teamRegistrations`, never hardcoded. Names and kinds only: never a
   subscription id, a full resource id or a secret.
6. **Carry the team's app registration identifiers** from those same outputs onto the team record
   when the deployment verifies. Phase 5's B18 issuer needs the registration's object id, and the
   run report is where it legitimately comes from — not a Graph lookup by display name.

**Verify:** a deployment whose environment is missing from `AIP_ENVIRONMENTS` fails with
`environment-not-configured` on the page instead of spinning; a healthy team reaches `active` and
lists its real resources; a regression test covers the discarded-reason path, which has none
today.

---

## Phase R7 — Status labels

**Status: built 19 Oct 2026** (see the dated note). Repositories: frontend, backend. Independent of the rest.

"Setting up" currently means both a credential being minted and any of six GitOps states, and
"Ready to view" reads like a document rather than working access.

1. Split the two meanings. A credential's `pending` becomes "Being created" in
   `format-label.js`. Deployments keep "Setting up", but `deployment-status.js` maps `requested`,
   `pr-raised`, `merged`, `deploying`, `deployed` and `verified` **explicitly** instead of letting
   them fall through a default, so a new backend status is visible rather than disguised.
2. `active` becomes "Ready to use".
3. On `/manage`: "Check progress" only while something is in progress, "Finish setting up" only
   where a step genuinely remains, otherwise "Manage in {teamName}".
4. The wait page heading stops promising a client secret during the earlier steps — "Setting up
   your model access" until the secret step, then the secret wording.
5. The backend's `PROGRESS_STEP_LABELS` fourth step matches the mocked reality from R5, and the
   page gets the terminal done state it needs.
6. One test per label map, plus the template tests, so every string is pinned.

**Verify:** no two different things share a label; a status the frontend does not know about
renders as unknown rather than as "Setting up".

---

## Phase R8 — Tests, documentation and built state

**Status: not started.** All repositories. Depends on R2 to R7.

1. A research-tier end-to-end journey test against Infradev, and a team-tier journey asserting the
   placeholder wording.
2. The backend README's live-Azure section replaces `SNDAIEEXPRGP1401`, `DEPLOYTESTDEFRA` and
   `kv-aip-sandbox-tenants` with the Infradev values.
3. [implemented-features.md](../../implemented-features.md), then a **separate**
   `ai-platform-discovery-docs` pull request re-dating B06 and B11 off "hand-configured resources"
   and updating B07, B09 and B16.
4. Security pass: no secret logged, `keyHint` everywhere but the two reveal points, the
   subscription scoped to the research API, Joi rejecting unknown keys, and the new role
   assignment confirmed least privilege.

**Verify:** the journey tests pass against Infradev; no repository still names the hand-built
resources.

---

## Order of work

Within the platform-then-portal ordering above:

1. **R0 and R1 in parallel.** R0 is a documentation afternoon; R1 is the bulk of the work. Both
   prerequisites that blocked them were answered on 19 Oct 2026.
2. **R2**, with owner confirmation, once R1 is released.
3. **R3 then R4**, both after R2 has applied — the portal must never point at a resource the
   platform has not built.
4. **R5, R6 and R7 in parallel with the above** — none of them touches Azure.
5. **R8 last**, because it records what the others did.

## Cross-phase rules

The rules in [build-stories-delivery-plan.md](build-stories-delivery-plan.md) `#cross-phase-rules`
apply unchanged: one branch per phase, tests with every behaviour change, a regression test with
every fix, `format` then `format:check`, `lint` and `test` before each pull request, a port with a
configuration-selected mock for every external system, a dated backfill for every new persisted
field, and never a full secret logged or persisted.

## Out of scope

- Moving the research tier to production, or to Sandbox. Recorded as direction in R0; built later.
- The private-topology rebuild of Infradev. Public access stays the Phase 1 concession.
- Retiring the hand-built `SNDAIEEXPRGP1401` resources. They stop being used; deleting them is a
  separate decision, after the credentials issued against them have expired.
- **Granting a shared research deployment to a team.** The design has it — a team API may list a
  shared deployment it does not own alongside its own — and this plan deliberately does not build
  it. Until it does, `gateway.allowedDeployments` on a team file holds only that team's own
  deployments, and a research deployment is reachable on `/research` only.
- **Project-scoped managed compute.** The platform uses provisioned throughput at the account, so
  a project never owns a deployment. If that changes, the project becomes a boundary and this
  plan's point 1 needs revisiting.
- B18's Graph client-secret issuer, which replaces R5's placeholder. That is Phase 5 of
  [build-stories-delivery-plan.md](build-stories-delivery-plan.md).

## Dated notes

**19 Oct 2026 — R7 built.** `deployment-status.js` maps every GitOps state explicitly: the six
"setting up" states, `queued`, `removing`, `removed` and the two failures. Anything else reads
"Status unknown" (grey, not refreshing, no "Check progress"), so a new backend status is visible
instead of disguised. `active` is "Ready to use"; a credential's `pending` is "Being created". The
team page offers "Check progress" only while a model is in progress and "See what happened" on a
failure. The wait page heading is "Setting up your model access" until every request has reached
`verified`, then "Setting up your team client secret". The backend's fourth step is "Preparing your
client secret" (it does not claim an Entra secret is made while R5's mock stands in), and `active`
now marks all four steps done. Still to do: R5's placeholder inset.

**19 Oct 2026 — R5 built.** `MOCK_TIERS=team` and the port-level mock already existed, so the work
was the labelling. One component, `placeholder-credential-notice` (a GOV.UK inset), is shown on the
credential page, a `/manage` row, the credential detail, rotated and revealed pages, and the wait
page. A credential is a placeholder when it is a team credential with `issuerKey: 'mock'`
(`placeholder-credential.js`); the wait page has no credential yet, so the backend's deployment
view carries `credentialPlaceholder` from `registry.isMockedFor('team')`. Page tests assert the
notice beside every mocked secret and its absence beside a real one; a backend test proves a
mocked team secret goes to the mock vault while a research secret reaches the real one. **The mock
vault stays in memory, decided deliberately:** a restart loses the secret and the reveal answers
404, acceptable for one demo run. Still to do: see it on Infradev.

**19 Oct 2026 — R6 built.** The retry bound is **5 attempts** (`GITOPS_VERIFY_MAX_ATTEMPTS`), one
per `GITOPS_POLL_MIN_INTERVAL_MS`, about 2.5 minutes at the default: long enough for an ARM state
to settle, short enough that a configuration fault is reported while the person is still on the
page. It is uniform across reasons rather than special-casing permanent ones. The last failure
ends the deployment as `deploy-failed` with the reason in `failureReason` and
`gitops.verification`, so the existing admin `retry` resumes it and resets the count. The "app
registration skipped" line reads the run report's `registration`, which Terraform leaves null
exactly when `entra.enabled` is off or `entra.teamRegistrations` is false, so the portal needs no
copy of the registry. Identifiers land on `oauthClient.registration` of the team's document for
the environment, with a dated backfill from reports already held. Still to do on the live
environment: confirm a healthy team reaches `active` and lists its resources.

**19 Oct 2026 — R6 rewritten around a real defect, not a cosmetic gap.** The reported symptom was
a team whose Azure resources exist sitting at "Setting up" for ever. The cause is in
`verifyDeployed`: it keeps only `{ verified }` from the resource verifier and discards the
`reason`, then returns `{ status: 'deployed' }` — the status the entry already holds — so nothing
is persisted, nothing is audited, and the next poll repeats it indefinitely. Because `deployed` is
non-terminal the page keeps showing progress, `verified → active` never happens, the model is
never added to `gateway.allowedDeployments`, and a credential request answers
`409 deployment-not-ready`. The verifier already computes a precise reason for all six failure
cases; the likeliest here is `environment-not-configured`, a missing `AIP_ENVIRONMENTS` entry,
which is configuration and today completely invisible. R6 now keeps the reason, bounds the
retries, audits the failure and surfaces it, before it gets to the resource list.

**19 Oct 2026 — three answers from the platform engineer.** (1) **No translation on the research
path.** The caller uses the endpoint the official imported spec defines, deployment name and all;
translating would add complication and buy nothing, because the research tier is static — one URL
and a pre-determined model list, with keys handed out against it. So `aip-request-model` is skipped
for this API, the allow-list is checked on the raw name, and the deployment names are written in
the research file and kept in the catalogue's `deploymentName` rather than derived. This reverses
the earlier note below on derived `research-{model}` names. (2) **The API stays `research`**, at a
static path, which is what the backend's subscription scope depends on. (3) **The project is just a
shared project in the Foundry instance**, as before; models are technically visible from it and
that is fine. The account/project distinction is provisioned throughput versus project-dedicated
managed compute, and the platform does not use the latter yet — so the exact semantics do not need
settling here.

**19 Oct 2026 — realigned to the model-access design diagram.** The first draft had the research
tier as a parallel stack: a bespoke `apim-research-api` module and a Foundry project holding the
approved deployments, both built in the platform state. The diagram shows otherwise and the code
agrees with the diagram, so three things changed. Deployments are **account** children visible to
every project, so a project is not a model boundary and the API's allow-list is; the `research`
API is **generated from a platform-owned team file** naming `subscription-key`, so there is no
second API builder, only a credential type the schema and `apim-team-api` must stop refusing; and
the research resources are therefore built by the **tenants** apply from a file an engineer
authors, not by the platform apply — which the pipeline-ordering section now states precisely.
This is why `aip-key-guard` and the global policy's `key` branch were built and left unreachable.
It also settled R3's open question on deployment names — though in the opposite direction to the
one recorded above, which supersedes this paragraph.

**19 Oct 2026 — prerequisites answered.** The custom API Management role is Terraform's, not an
admin's: the deploy identity already holds User Access Administrator, so no further grant is
needed, and the definition and assignment must be idempotent across repeated applies. Research
capacity starts as low as the design allows and is raised deliberately. The platform engineer also
fixed the ordering this plan must respect — bootstrap once, then the platform IaC pipelines, then
the portal's orchestration and the tenant pipelines — which is now a section of its own, because
everything the research tier builds is platform layer and none of it may drift into the tenants
state or be triggered from the portal.

**19 Oct 2026 — written.** No phase started. The findings that shaped it: the research tier has
never existed in IaC at all, only the `aip-key-guard` fragment and the catalogue markers that
anticipate it; `modules/foundry-project` is team-shaped and needs generalising before it can serve
the platform; and the Portal API principal holds no API Management role on the Infradev instance,
so repointing configuration alone would fail at the first key issue.

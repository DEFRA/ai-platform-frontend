# Research tier integration plan: ARM-based credential issuing, Foundry-derived catalogue, Key Vault

> Cross-cutting integration plan, not a journey route. Replaces the mocked seams behind
> [Route 1](../route1-plan.md) (research/shared tier) with real Azure and GitHub integrations, and
> makes credential issuing provider-extensible. See also [Route 0](../route0-welcome-plan.md),
> [Route 2](../route2-plan.md), [Route 3](../route3-plan.md) and the
> [UI flow](../../ui-flow-three-routes.md).
>
> **STATUS: NOT STARTED — planned 30 Sept 2026.** Revision 4: a **second, separate** app
> registration is provided for Azure ARM access (client ID + secret, Contributor + User Access
> Administrator on the subscription) — so no service principal creation and **no certificates**.
> CDP deployment is deferred to Phase 6; everything before it runs locally against the sandbox.

## The goal

Everything in this plan exists to make one end-to-end path real:

```text
user signs in → requests access to a model → backend calls ARM → APIM subscription created
  → user receives key → user calls the gateway → APIM policy checks the allow-list
  → APIM authenticates to Foundry with its managed identity → model responds
```

**Definition of done.** All five must pass against the sandbox:

1. `GET /v1/models` returns models that correspond to **real Foundry deployments**, sourced from the
   catalogue in `ai-platform-infra` and synced into MongoDB.
2. `POST /v1/credentials` creates a real APIM subscription through ARM and returns a working key.
3. That key calls `https://{gateway}/research/deployments/{deployment}/chat/completions` and gets a
   model response back.
4. Rotate, renew and suspend all work through ARM and are observable in the APIM blade.
5. `DELETE /v1/credentials/{id}` revokes, and the same call then returns 401.

## What this changes

Route 1 shipped on 22 Sept 2026 against two mocks. This plan replaces both, adds the credential
persistence the design pack requires, and restructures issuing so it is not Azure-only:

| Seam | Today | After this plan |
|------|-------|-----------------|
| Credential issuing | [`mock-credential-issuer.js`](../../../../ai-platform-backend-api/src/adapters/mock-credential-issuer.js) generates a fake key locally | Azure **ARM management-plane** adapter behind the same `CredentialIssuer` port |
| Provider choice | Hardcoded default parameter | Registry keyed by provider; adding AWS Bedrock is a new adapter plus one registry entry |
| Model catalogue | [`models.seed.json`](../../../../ai-platform-backend-api/src/common/seed/models.seed.json) re-seeded on every start | Derived from real Foundry deployments, held in `ai-platform-infra/catalogue/`, read via Octokit and synced to MongoDB |
| Credential storage | Secret returned once, never persisted anywhere | Written to `kv-aip-{env}-tenants` Key Vault, with an audited view/re-share path |

## Critical correction: ARM management plane, not APIM's own APIs

The original requirement asked for `/models`, `/issue`, `/renew`, `/revoke` and `/suspend` endpoints
to be added to APIM. **Four of those are not APIs you author on APIM** — they are Azure Resource
Manager operations on the APIM resource itself.

Two traps worth naming, because both look plausible:

**Trap 1 — the legacy direct management API.** APIM also exposes
`https://{apim}.management.azure-api.net`, authenticated with a SharedAccessSignature token. It is
*not* what this plan uses. Everything here goes to `https://management.azure.com` with an OAuth
**bearer** token from Entra ID, acquired for the `https://management.azure.com/.default` scope. ARM
gives Entra-issued tokens, RBAC-scoped roles and activity-log auditing, with no shared gateway
secret; the legacy endpoint gives none of those.

**Trap 2 — authoring a facade.** Creating `/issue` and `/revoke` operations *on* APIM, fronting
something else, would put credential management on the same gateway it manages, reachable by anyone
holding a gateway key. Control plane and data plane stay separate.

All five lifecycle operations, with `api-version=2024-05-01` and
`{base} = https://management.azure.com/subscriptions/{subId}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{apim}`:

| Port method | ARM call | Notes |
|-------------|----------|-------|
| `issue` | `PUT {base}/subscriptions/{sid}` with `{"properties":{"scope":"{base}/apis/{apiId}","displayName":"...","state":"active"}}`, then `POST {base}/subscriptions/{sid}/listSecrets` | The key is never returned by `PUT` or `GET` — `listSecrets` is the only way to read it |
| `rotate` | `POST {base}/subscriptions/{sid}/regeneratePrimaryKey`, then `listSecrets` | Let Azure mint the key rather than supplying our own. Returns 204 with no body, hence the second call |
| `renew` | `PATCH {base}/subscriptions/{sid}` with `{"properties":{"expirationDate":"..."}}` | APIM's `expirationDate` is **audit metadata only** — it deactivates nothing. The backend keeps owning TTL enforcement |
| `suspend` | `PATCH {base}/subscriptions/{sid}` with `{"properties":{"state":"suspended"}}` | |
| `revoke` | `DELETE {base}/subscriptions/{sid}` | |

**`PATCH` and `DELETE` require an `If-Match` header.** Send the ETag from a prior read, or `*`.
Omitting it returns 412 and is an easy half-hour to lose.

`/models` is not an APIM concept either: model metadata comes from the catalogue, and liveness from
the Cognitive Services ARM deployments list.

What APIM genuinely needs authored is the **data plane** that an issued key unlocks: a `research`
API at path `/research` with the `aice-shared` Foundry backend enabled and a policy attached. That
is infrastructure work, and it is Phase 0.

## Identity: two separate app registrations

The single easiest thing to get wrong, because the obvious environment variable names are already
taken.

| App registration | Purpose | Lives in | Environment variables |
|------------------|---------|----------|-----------------------|
| **Existing** | Entra ID SSO / sign-in **only** | frontend [`config.js`](../../../src/config/config.js) as `azureAd.*` | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` |
| **New** | Backend → Azure ARM, for the credential issuer | backend `src/config.js` as `armAuth.*` | `AZURE_ARM_TENANT_ID`, `AZURE_ARM_CLIENT_ID`, `AZURE_ARM_CLIENT_SECRET` |

The new registration is provided to us, not created by this plan. It holds **Contributor** and
**User Access Administrator** on the subscription, and uses a **client secret — no certificates**.

```text
ClientSecretCredential(armAuth.tenantId, armAuth.clientId, armAuth.clientSecret)
  .getToken('https://management.azure.com/.default')
  → Authorization: Bearer <token>
```

### Why the new variables must be namespaced `AZURE_ARM_*`

Three separate failure modes if they reuse the SSO names:

1. **Silent inheritance.** `AZURE_TENANT_ID` is already set at the *environment* level in
   `cdp-app-config/environments/*/defaults.env` for SSO. The backend would pick it up
   automatically. If the ARM registration sits in a different tenant, it fails looking like a bad
   secret.
2. **Two secrets, one name.** Two different `AZURE_CLIENT_SECRET` values for two different
   registrations, indistinguishable in CDP secrets by name alone.
3. **The nasty one.** `@azure/identity`'s `EnvironmentCredential` and `DefaultAzureCredential` read
   *exactly* `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`. We construct
   `ClientSecretCredential` explicitly, so this is safe today — but anyone later "simplifying" to
   `DefaultAzureCredential` would silently authenticate to ARM as the **SSO** registration, and fail
   with a permissions error pointing at entirely the wrong thing.

The config section is named `armAuth` rather than `azure`, deliberately mirroring the frontend's
`azureAd`: **`azureAd` is who the user is; `armAuth` is what the backend may do in Azure.**

### Two consequences of the roles it holds

**Contributor does not grant secret access.** On an RBAC-authorised Key Vault, Contributor manages
the *vault* but cannot read or write *secrets*. Phase 3 needs an explicit **Key Vault Secrets
Officer** assignment — step 0.10. User Access Administrator is what lets us make that assignment
ourselves, so it is self-service, but it will not work until it is done.

**Contributor plus User Access Administrator on the whole subscription is very broad.** UAA can
grant any role to any principal, including itself, which is a privilege-escalation path. Acceptable
for a sandbox integration test; it should not follow this service into any shared environment. The
narrow replacement is in Phase 6.3, and tightening it is a prerequisite for promotion, not an
optional cleanup.

## Design facts that override intuition

Sourced from
[design-orchestration.md](../../../../ai-platform-discovery-docs/src/content/design-orchestration.md)
and
[design-infrastructure.md](../../../../ai-platform-discovery-docs/src/content/design-infrastructure.md).
Each of these is easy to get wrong by reasoning from first principles:

1. **APIM products are not used.** *"Why the boundary is an API for each team and not a product in
   API Management... Products are not used. The path selects the team's policy; the token or key
   proves the caller is that team."* The research subscription must therefore be **API-scoped** —
   `scope: /apis/{researchApiId}` — not `/products/research`.
2. Research is a platform-owned team named `research`, with an API at `/research` and shared
   deployments. It exists only in SND4 (sandbox) and SND1 (infradev). **There is no `/research`
   path in production.**
3. Per-user subscriptions matter: on `/research` the `llm-token-limit` counter is keyed on the
   caller's subscription, so each research user gets a separate allowance. One shared key would
   collapse that.
4. The backend owns TTL and the renewal cap, because APIM cannot expire a key. A scheduled job
   suspends and then deletes past-expiry subscriptions through the `CredentialIssuer` port — this
   is already built as `POST /maintenance/expire-credentials`.
5. Catalogue: a `CatalogueSource` port with a `github` adapter reading `catalogue/` at each
   environment's pinned release *"with ETag caching on start and on a schedule"*, plus a `file`
   adapter for local development. Records are mirrored to MongoDB with `catalogueSha` and
   `release`. **The nightly refresh is the design, not an addition to it.**
6. Availability rule: a model is available when the catalogue at that environment's release says
   `eligible`, lists the environment, **and** the deployment's ARM `provisioningState` is
   `Succeeded`. Catalogue alone is not enough.
7. Key Vault (`kv-aip-{env}-tenants`):
   - Holds every credential the platform issues, *"one secret per credential named by an opaque
     credential ID, tagged `aip-team`, `aip-service-code` and `aip-environment`"*.
   - Backend principal is **Key Vault Secrets Officer at vault scope**; no other data-plane
     principal; teams have no access of any kind.
   - *"Tenant separation inside the tenants vault is enforced by the backend, not by Key Vault"* —
     the backend resolves the caller's team and role from MongoDB before it names a secret.
     Per-secret role assignments are deliberately not used.
   - *"View or re-share an existing credential... audited with actor, credential ID and reason...
     the value is rendered once per request and never cached."*
   - Secrets soft-deleted for 90 days; purge protection on the vault.
8. *"Production refuses to start with a mock adapter selected for any of the direct paths."* — so
   adapter selection needs a config flag and a production startup guard.

## Blocking fact

`DEFRA/ai-platform-infra` and `DEFRA/ai-platform-tenants` both exist on GitHub but are
**completely empty** (verified 30 Sept 2026). The catalogue the design points at does not exist
yet, so Phase 1 has to create it from the current seed file.

---

# Phase 0 — Azure setup

Run these against the sandbox subscription, signed in as the **new** ARM app registration. No
service principal creation, no certificates, no CDP configuration — all of that is either already
done or deferred to Phase 6. Shell is PowerShell.

## 0.1 Set variables and confirm the app registration works

```powershell
az login --service-principal -u <armClientId> -p <armClientSecret> --tenant <armTenantId>
az account set --subscription "<sandbox-subscription-id>"
$SUB     = az account show --query id -o tsv
$RG      = "rg-aip-sandbox-platform"      # confirm actual name
$APIM    = "apim-aip-sandbox"             # confirm actual name
$FOUNDRY = "aice-shared"                  # the Foundry / AI Services account
$APIMID  = "/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.ApiManagement/service/$APIM"
$FNDID   = "/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.CognitiveServices/accounts/$FOUNDRY"
```

Verify — this is the gate for the whole plan:

```powershell
az rest --method get --url "https://management.azure.com$APIMID/subscriptions?api-version=2024-05-01"
az apim show -g $RG -n $APIM --query "{sku:sku.name,state:provisioningState,gateway:gatewayUrl}"
```

A 200 on the first means the app registration can manage APIM subscriptions, which is what Phase 1
depends on. A 403 means the role assignment is wrong or has not yet propagated.

Record the gateway URL — it becomes `APIM_GATEWAY_BASE_URL`.

## 0.2 Audit what is actually on APIM today

```powershell
az apim api list -g $RG --service-name $APIM -o table
az apim product list -g $RG --service-name $APIM -o table
az rest --method get --url "https://management.azure.com$APIMID/backends?api-version=2024-05-01"
az rest --method get --url "https://management.azure.com$APIMID/subscriptions?api-version=2024-05-01"
```

Expect the stock samples: `echo-api`, products `starter` / `unlimited`, and the built-in `master` /
`all-apis` subscriptions. Write down anything that is **not** stock before deleting anything.

Also establish exactly what "the `aice-shared` backend is disabled" means — a tripped
`circuitBreaker`, a backend pointing at a dead URL, or no backend record at all. The fix in 0.5
differs per case.

**Keep `echo-api` for now.** Phase 1 uses it to prove key issuance before the `research` API exists,
which is what lets backend work start in parallel with the rest of this phase. Removing the samples
is a Phase 6 tidy-up, once nothing depends on them — the products in particular should go, because
a request carrying no key is matched to an open product when the API sits in at most one such
product, so leaving `starter` in place would let a keyless request reach an API.

## 0.3 List the Foundry deployments — these become the catalogue

```powershell
az cognitiveservices account show -g $RG -n $FOUNDRY `
  --query "properties.{endpoint:endpoint,localAuthDisabled:disableLocalAuth,publicAccess:publicNetworkAccess}"

az cognitiveservices account deployment list -g $RG -n $FOUNDRY `
  --query "[].{name:name,model:properties.model.name,version:properties.model.version,format:properties.model.format,sku:sku.name,state:properties.provisioningState}" -o table
```

This output is the **source for Phase 2's catalogue files** — it is what "models reflecting those in
Foundry" means in practice. Save it: every `name` becomes a `deploymentName`, and belongs in the
`research-allowed-deployments` named value in 0.7.

If `localAuthDisabled` is `true` (it should be), the `authentication-managed-identity` policy in 0.7
is mandatory rather than optional. If there are no deployments, create at least one before
continuing.

## 0.4 Give APIM's managed identity data-plane access to Foundry

```powershell
$APIMMI = az apim show -g $RG -n $APIM --query identity.principalId -o tsv
az role assignment create --assignee $APIMMI --role "Azure AI User" --scope $FNDID
```

The role has been renamed twice (Cognitive Services User → Azure AI User → Foundry User). Confirm
the current name and use whichever exists:

```powershell
az role definition list --query "[?contains(roleName,'AI User')].roleName" -o tsv
```

This managed identity must be the **only** data-plane principal on the account.

Verify: `az role assignment list --assignee $APIMMI --scope $FNDID -o table`

## 0.5 Create or repair the Foundry backend in APIM

```powershell
$body = @{ properties = @{
  url         = "https://$FOUNDRY.openai.azure.com/openai"
  protocol    = "http"
  description = "aice-shared Foundry account"
} } | ConvertTo-Json -Depth 5

az rest --method put `
  --url "https://management.azure.com$APIMID/backends/aice-shared?api-version=2024-05-01" `
  --body $body
```

Use the real endpoint from 0.3, not a guessed hostname. If a tripped circuit breaker was the cause,
this PUT — which carries no `circuitBreaker` block — clears it.

Verify: `az rest --method get --url "https://management.azure.com$APIMID/backends/aice-shared?api-version=2024-05-01"`

## 0.6 Create the `research` API at /research

```powershell
az apim api create -g $RG --service-name $APIM `
  --api-id research --path research --display-name "Research tier" `
  --protocols https --subscription-required true `
  --service-url "https://$FOUNDRY.openai.azure.com/openai"

az apim api operation create -g $RG --service-name $APIM --api-id research `
  --operation-id chat-completions --display-name "Chat completions" `
  --method POST --url-template "/deployments/{deployment-id}/chat/completions" `
  --template-parameters name=deployment-id type=string required=true
```

`--subscription-required true` is what makes the issued key mean anything. One operation is enough
for the MVP; more follow per `apiProfile`.

Verify: `az apim api show -g $RG --service-name $APIM --api-id research --query "{path:path,subRequired:subscriptionRequired}"`

## 0.7 Set the API policy

First create the named value holding the research allow-list, populated from the deployment names
recorded in 0.3:

```powershell
az apim nv create -g $RG --service-name $APIM `
  --named-value-id research-allowed-deployments `
  --display-name research-allowed-deployments --value "gpt-4-1,gpt-4o"
```

Then `research-policy.xml`:

```xml
<policies>
  <inbound>
    <base />
    <set-variable name="allowed" value="{{research-allowed-deployments}}" />
    <set-variable name="deployment" value="@((string)context.Request.MatchedParameters["deployment-id"])" />
    <choose>
      <when condition="@(!((string)context.Variables["allowed"] ?? "").Split(',').Contains((string)context.Variables["deployment"]))">
        <return-response>
          <set-status code="403" reason="Forbidden" />
          <set-header name="Content-Type" exists-action="override"><value>application/json</value></set-header>
          <set-body>{"code":"model-not-granted"}</set-body>
        </return-response>
      </when>
    </choose>
    <set-backend-service backend-id="aice-shared" />
    <authentication-managed-identity resource="https://cognitiveservices.azure.com" />
    <llm-token-limit counter-key="@(context.Subscription.Id)" tokens-per-minute="10000"
                     estimate-prompt-tokens="false" remaining-tokens-header-name="x-ratelimit-remaining-tokens" />
    <llm-emit-token-metric namespace="aip">
      <dimension name="team" value="research" />
      <dimension name="deployment" value="@((string)context.Variables["deployment"])" />
      <dimension name="credentialType" value="key" />
    </llm-emit-token-metric>
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
```

Apply it:

```powershell
$xml = Get-Content research-policy.xml -Raw
$pbody = @{ properties = @{ format = "xml"; value = $xml } } | ConvertTo-Json -Depth 5
az rest --method put `
  --url "https://management.azure.com$APIMID/apis/research/policies/policy?api-version=2024-05-01" `
  --body $pbody
```

`authentication-managed-identity` is the single most commonly missed line. Without it every call
returns 401 from Foundry, because local auth is off and APIM never presents its managed identity
token. Diagnosing that after the fact is unpleasant.

Verify: the PUT returns 200/201, and a GET of the same URL echoes the XML back.

## 0.8 Smoke test — prove the data plane before writing any backend code

```powershell
$sbody = @{ properties = @{
  scope = "$APIMID/apis/research"; displayName = "manual smoke test"; state = "active"
} } | ConvertTo-Json -Depth 5

az rest --method put --url "https://management.azure.com$APIMID/subscriptions/manual-smoke-test?api-version=2024-05-01" --body $sbody
$KEY = az rest --method post --url "https://management.azure.com$APIMID/subscriptions/manual-smoke-test/listSecrets?api-version=2024-05-01" --query primaryKey -o tsv
```

Then, from a host that can resolve the gateway — APIM has a private VIP, so a hub-connected VM or a
CDP box, not a laptop on the open internet:

```bash
curl -s -X POST "https://<gateway>/research/deployments/gpt-4-1/chat/completions?api-version=2024-05-01-preview" \
  -H "Ocp-Apim-Subscription-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

**This is the gate.** Expect a completion. Then confirm the negative paths:

- the same curl against a deployment *not* in the named value → 403 `model-not-granted`
- the same curl with no key header → 401

Clean up:

```powershell
az rest --method delete --url "https://management.azure.com$APIMID/subscriptions/manual-smoke-test?api-version=2024-05-01"
```

Do not start Phase 1's Azure-mode testing until this passes. If a hand-made key does not return a
completion, no amount of adapter code will help.

## 0.9 Create the tenants Key Vault and grant secret access

```powershell
$KV = "kv-aip-sandbox-tenants"
az keyvault create -g $RG -n $KV --location uksouth `
  --enable-rbac-authorization true --enable-purge-protection true --retention-days 90
$KVID = az keyvault show -g $RG -n $KV --query id -o tsv

az role assignment create --assignee <armClientId> --role "Key Vault Secrets Officer" --scope $KVID
```

Purge protection cannot be turned off once enabled. That is intended — the design relies on 90-day
soft delete as the safety net.

**The role assignment is not optional.** Contributor manages the vault but cannot read or write
secrets on an RBAC-authorised vault; without Secrets Officer, Phase 3 fails in a way that looks like
a bad connection string. User Access Administrator is what lets us grant it ourselves.

Network restrictions are deliberately omitted here. This runs locally against sandbox, so default
public access is what makes the vault reachable; locking it to CDP egress ranges belongs with
Phase 6.3.

Verify: `az keyvault secret set --vault-name $KV --name probe --value x`, then delete it.

## 0.10 GitHub access for the catalogue

For the first integration pass, a **fine-grained personal access token** with Contents:Read on
`DEFRA/ai-platform-infra` is enough, and avoids the GitHub App ceremony. The `github` adapter in
Phase 2 accepts either.

The design's end state is a GitHub App (`ai-platform-orchestrator`, or
`ai-platform-orchestrator-infradev` for the test instance) with Contents:Read, installed on
`ai-platform-infra` only rather than all repositories. Switch to it when the team tier needs
Contents-write and pull requests.

## Phase 0 exit criteria

0.1 returns 200; 0.8 returns a completion and the 403/401 negative paths behave; 0.9's probe secret
writes and deletes; and the Foundry deployment list from 0.3 is saved for Phase 2.

---

# Phase 1 — Provider-extensible, ARM-based credential issuing

The point is not only "call Azure" — it is that a second provider (AWS Bedrock, or anything else)
should need **no edit to `credential-service.js`**.

Phase 1 can be proven against `echo-api` before the `research` API exists, which is why 0.2 keeps
it. That decouples "can we mint a working key" from "does the key reach a model", so this phase can
start as soon as 0.1 returns 200.

## 1.1 `src/adapters/azure/arm-client.js` (new)

Single responsibility: acquire a token and make an authenticated ARM request. It knows nothing about
credentials, subscriptions or models.

- `ClientSecretCredential(tenantId, clientId, clientSecret)` from `armAuth.*` — one instance, built
  in one place. No certificate path and no credential-type factory: there is exactly one auth method
  today, and the point of isolating construction here is that swapping to a certificate or managed
  identity later is a one-line change rather than an abstraction we carry now.
- Token via `getToken('https://management.azure.com/.default')`, sent as
  `Authorization: Bearer <token>`. `@azure/identity` caches and refreshes it.
- Base URL is `https://management.azure.com` — never `{apim}.management.azure-api.net`.
- Exposes one method, `request(method, path, { body, ifMatch })`, so callers cannot reach anything
  else.

Dependencies: `@azure/identity` plus native `fetch`, rather than `@azure/arm-apimanagement`. Five
simple REST calls, no pagination and no long-running operations, so the SDK's main benefits do not
apply — one dependency instead of two. If broad ARM surface is needed later, swapping the SDK in is
contained to this one file. Add `nock` as a dev dependency: the repo has only `vitest-fetch-mock`
today, and these tests need HTTP-level interception.

## 1.2 `src/adapters/credential-issuer.js` (existing port — one change)

Keep all five methods and the overall shape. Rename the returned `apimSubscriptionId` to
**`externalId`**. It is the only Azure-specific term in an otherwise provider-neutral interface, and
Bedrock has no "APIM subscription". Keep writing it to the existing Mongo field for now — one line of
mapping in the service, no migration.

## 1.3 `src/adapters/azure/apim-credential-issuer.js` (new)

`createApimCredentialIssuer({ armClient, config })` — a factory returning the port shape, not a class
(AICE style guide: classes only when state genuinely needs encapsulating). Implements the five ARM
calls from the table above, including `If-Match` on `PATCH` and `DELETE`.

`sid` stays `research-{userId}-{modelSlug}` — deterministic, so a retry after a timeout updates the
same subscription rather than creating a second one. Map ARM failures to the existing stable
`502 upstream-unavailable`. Never log the key or the raw ARM response body.

## 1.4 `src/adapters/credential-issuer-registry.js` (new)

Roughly thirty lines. A map of `issuerKey → issuer`, plus:

- `forModel(model)` — resolves by the model's `provider` / `offering`, returns `{ issuerKey, issuer }`
- `forCredential(credential)` — resolves by the credential's stored `issuerKey`

Adding AWS Bedrock becomes one new adapter file and one registry entry. Nothing else changes.

## 1.5 Persist `issuerKey` on the credential document

The change that actually buys extensibility, cheap now and painful later. Without it,
`revokeCredential` on a Bedrock credential has no way to know which provider to call — you end up
sniffing ID prefixes, exactly the trap `mock-credential-issuer.js` already falls into with
`apimSubscriptionId.startsWith('team-')`.

Backfill in `src/common/backfills/registry.js` setting `issuerKey: 'mock'` on existing documents, so
lifecycle operations on already-issued dev credentials keep working.

## 1.6 Wire into `credential-service.js`

Replace the `issuer = mockCredentialIssuer` default parameter with an injected **registry**. Keep the
parameter for test injection — tests pass a registry wrapping a stub. Resolve per operation:
`forModel` on issue, `forCredential` on renew / rotate / revoke / suspend.

## 1.7 Adapter selection and the production guard

Add `PROVISIONING_MODE` (`mock` | `azure`) to `src/config.js`. Build the registry once at startup
onto `server.app`. Throw at startup if the environment is production and the mode is `mock`, per
design fact 8. `armAuth.clientSecret` is required when the mode is `azure` — fail fast with a clear
message rather than surfacing a 401 from ARM on the first credential issue.

## 1.8 Contract test — the part that makes provider three safe

One shared test suite, exported from a helper module in `src/adapters/` and excluded from coverage in
`vitest.config.js`, run against **both** the mock and the nocked APIM adapter. It asserts the
substitutability the port promises: same inputs produce the same output shape, `keyHint` is always
the last four characters of the secret, `revoke` is idempotent, errors surface consistently.

Asserting Liskov substitution in prose achieves nothing. A shared suite every new adapter must pass
is what stops the third provider quietly breaking the service.

## SOLID mapping

| Principle | How |
|-----------|-----|
| Single responsibility | ArmClient authenticates; the issuer translates port calls to ARM; the registry resolves; `credential-service` orchestrates |
| Open/closed | New provider = new adapter + one registry entry; no edit to `credential-service.js` |
| Liskov substitution | Enforced by the shared contract suite in 1.8, not by convention |
| Interface segregation | The port keeps its five methods; ArmClient exposes only `request()` |
| Dependency inversion | The service depends on the registry abstraction, never on a concrete Azure client |

# Phase 2 — Catalogue from Foundry, through the infra repo, into MongoDB

The "models reflecting those in Foundry" half of the goal, and independent of Phase 1 — the two can
run in parallel. The chain is deliberate: Foundry is the truth about what *exists*, the catalogue is
the truth about what is *allowed*, and MongoDB is the read model the API serves.

1. **Generate the catalogue from 0.3's deployment list.** Create `catalogue/providers/{id}.json`,
   `catalogue/models/{slug}.json` and `catalogue/schema/*.json` in `ai-platform-infra`, one model
   file per real Foundry deployment, enriched with the descriptive fields from
   [`models.seed.json`](../../../../ai-platform-backend-api/src/common/seed/models.seed.json):
   - from Foundry: `deploymentName`, `modelName`, `version`, `offering` (from `model.format`),
     `skus[]`
   - from the existing seed: `displayName`, `description`, `useCases[]`, `family`
   - added by policy: `tiers[]`, `environments[]`, `dataZone`, `regions[]`, `apiProfile`
     (`chat-completions`), `capacityPolicy` `{min,max,default}`, `limitsDefault`, `lifecycle`
     `{status, retirementDate}`, `eligibility` `{eligible, reason}`
   - **drop `endpoint`** — the backend composes the gateway URL from the APIM base plus the path and
     `apiProfile`, rather than storing it per model

   `provider` / `offering` is also what `registry.forModel()` keys on in Phase 1, so this is the
   field that would route a Bedrock model to a Bedrock issuer. Tag the result `v0.1.0` so there is a
   pinned release to read.
2. New port `src/adapters/catalogue-source.js` —
   `fetchCatalogue({ ref }) => { models[], providers[], catalogueSha, release }`.
3. New `src/adapters/github/github-catalogue-source.js` — Octokit, authenticating with either the
   fine-grained PAT from 0.10 or a GitHub App installation token. Use
   `git.getTree({ tree_sha: ref, recursive: 'true' })` then fetch blobs for `catalogue/**/*.json`;
   the tree SHA becomes `catalogueSha`. Conditional requests via ETag. On a 304, or on any failure,
   keep the last good mirror — a transient GitHub outage must never empty the catalogue.
4. New `src/adapters/file-catalogue-source.js` reading a local folder, for dev and tests.
5. New `src/services/catalogue-service.js` — `syncCatalogue(db, source)` upserts by slug with
   `catalogueSha` / `release` / `syncedAt`. Models absent from the catalogue are **retired**
   (`eligible: false`, `lifecycle.status: 'retired'`), never deleted, because credentials reference
   slugs. Guard with a `mongo-locks` lock named `catalogue-sync` so replicas do not duplicate work.
   Call `invalidateModelsCache()` afterwards.
6. Swap the `seedModels` call in `src/plugins/mongodb.js` for `syncCatalogue`. Keep
   `models.seed.json` and the file adapter as the local and test default, so `npm test` and compose
   need no network.
7. Add a backfill in `src/common/backfills/registry.js` to reshape existing `models` documents —
   the CDP `dev` environment holds real data.

# Phase 3 — Key Vault persistence and view/re-share

Depends on 0.9.

1. New port `src/adapters/credential-vault.js` —
   `{ put({credentialId, secret, tags, expiresOn}), get({credentialId}), remove({credentialId}) }`.
   Kept separate from `CredentialIssuer` because the design treats them as sequential steps
   (*"through the `CredentialIssuer` port, **then** written to `kv-aip-{env}-tenants`"*), and
   because it leaves the issuer port signature untouched.
2. New `src/adapters/azure/key-vault-credential-vault.js` using the `SecretClient` from
   `@azure/keyvault-secrets`, with the same `ClientSecretCredential` built in 1.1. Secret name
   `cred-{mongoId}` — opaque, and valid against Key Vault's `^[0-9a-zA-Z-]+$` name rule. Tags
   `aip-team` (`research` for this tier), `aip-service-code`, `aip-environment`. Set `expiresOn`
   from the credential expiry so the vault reflects the TTL too.
3. New `src/adapters/mock-credential-vault.js` — in-memory, for dev and tests, selected by the same
   `PROVISIONING_MODE` guard as the issuer.
4. Wire into
   [`credential-service.js`](../../../../ai-platform-backend-api/src/services/credential-service.js):
   - `issueCredential`: after `issuer.issue()` succeeds, call `vault.put()`. On vault failure do
     **not** fail the request — the user already holds their key — instead set
     `vaultState: 'unwritten'` on the credential document and still return the secret.
   - `rotateCredential`: `vault.put()` again, creating a new Key Vault version; the old version
     stays recoverable inside the 90-day window.
   - `revokeCredential`: `vault.remove()`, which soft-deletes for 90 days.
   - Never write the secret to MongoDB. `keyHint` remains the only stored fragment.
5. Recovery: extend `reconcilePendingCredentials` in
   `src/services/maintenance-service.js` to retry records flagged `vaultState: 'unwritten'`. This
   works precisely because `listSecrets` is repeatable — the reconcile job re-reads the key from
   APIM and writes it to the vault. No secret has to be parked anywhere in the meantime.
6. New route `POST /v1/credentials/{id}/reveal` in `src/routes/credentials.js`. POST rather than
   GET: it is a state-changing, audited action, and a secret must never sit in a URL, a query
   string or an access log.
   - Joi payload `{ reason: string().max(500).required() }`, `.unknown(false)`.
   - Authorisation: research tier → the owning user only; team tier → team admin (reuse
     `getMemberRole`) or platform operator. Return 404 rather than 403 for a credential the caller
     does not own, matching the existing `findCredentialForViewing` behaviour.
   - Refuse when status is `revoked` or `failed`; return 404 when `vaultState` is `unwritten`.
   - Response sets `Cache-Control: no-store` and `Pragma: no-cache`.
   - `recordAuditEvent` with the actor, action `credential.reveal`, the resource ID and the reason.
     The reason is stored; **the secret is not**, and never reaches a log line.
7. New service function `revealCredential(db, vault, { credentialId, actorUserId, reason })` in
   `credential-service.js` holding that authorisation and audit logic, so the route stays thin per
   repo convention.

# Phase 4 — Liveness reconcile and scheduled sync

Depends on Phases 1 and 2. Closes the loop between the catalogue and what is actually deployed in
Foundry.

1. New `src/adapters/azure/foundry-deployments.js` — ARM
   `GET {accountBase}/deployments?api-version=2024-10-01` through the same `armClient`. Contributor
   already covers this read; the narrow role in 6.3 adds `Reader` on the Foundry account to replace
   it, which is control-plane only and grants no inference.
2. Extend `syncCatalogue` with the design's availability rule (design fact 6). Store
   `provisioningState` and `lastReconciledAt` so the UI can explain why a model is greyed out.
3. New token-gated `POST /maintenance/sync-catalogue` in `src/routes/maintenance.js`, matching the
   `x-maintenance-token` pattern already used by `/maintenance/expire-credentials`.
4. Also sync on startup, per the design's "on start and on a schedule". No in-process timer — reuse
   whatever already triggers `/maintenance/expire-credentials`. The trigger itself is an ops task.

# Phase 5 — Frontend

Depends on Phases 2, 3 and 4.

1. `src/server/routes/connect/shared/credential/` — show the real gateway URL and `/research` path,
   and the real `Ocp-Apim-Subscription-Key` header name, replacing anything derived from the mock
   `endpoint` field.
2. `src/server/routes/models/` list and detail — render `lifecycle.status`, `eligibility.reason` and
   the new "deployment not live" state, instead of silently hiding ineligible models.
3. Code snippets keyed off `apiProfile` (design: *"snippets and tabs follow `apiProfile`"*),
   replacing any hardcoded chat-completions shape.
4. Map `model-not-granted` (403, gateway-level) to GOV.UK error copy. It is distinct from the
   existing catalogue-level `model-not-eligible`.
5. **New for Key Vault:** a view-credential journey under `/manage`.
   `GET /manage/credentials/{id}/view` renders a GOV.UK form with a required "Why do you need to see
   this?" textarea, mirroring the backend's `reason`; the POST calls the reveal endpoint and shows
   the secret once on the result page. CSRF-protected via the existing `@hapi/crumb`. The result
   page must set `Cache-Control: no-store` and be excluded from any session or response cache —
   reuse whatever the existing one-time credential page already does.

# Phase 6 — CDP deployment and docs

Everything before this runs locally against the sandbox. This phase is what makes it deployable.

1. Add `AZURE_ARM_TENANT_ID`, `AZURE_ARM_CLIENT_ID` and `AZURE_ARM_CLIENT_SECRET` to CDP secrets for
   `ai-platform-backend-api`, plus `GITHUB_TOKEN` or the GitHub App private key. **These belong to
   the new ARM app registration** — do not reuse or overwrite the frontend's `AZURE_CLIENT_ID` /
   `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID`, which stay SSO-only. Non-secret identifiers go into
   `cdp-app-config/environments/<env>/defaults.env`.
2. Confirm egress. CDP routes all outbound traffic through Squid
   (`HTTP_PROXY=http://localhost:3128`): `management.azure.com`, `login.microsoftonline.com`,
   `api.github.com` and `{vault}.vault.azure.net` must all be reachable, and none caught by
   `GLOBAL_AGENT_NO_PROXY`. The APIM **gateway** (private VIP) is not reachable from CDP and does
   not need to be — only the browser or the consumer's own workload calls it.
3. **Replace Contributor + User Access Administrator with a narrow custom role** before this service
   runs anywhere shared, and lock the tenants vault to CDP egress ranges:

   ```json
   {
     "Name": "AIP Backend APIM Subscriptions",
     "IsCustom": true,
     "Description": "Issue, read, rotate and revoke APIM subscriptions for the AI Platform portal backend.",
     "Actions": [
       "Microsoft.ApiManagement/service/read",
       "Microsoft.ApiManagement/service/apis/read",
       "Microsoft.ApiManagement/service/subscriptions/read",
       "Microsoft.ApiManagement/service/subscriptions/write",
       "Microsoft.ApiManagement/service/subscriptions/delete",
       "Microsoft.ApiManagement/service/subscriptions/listSecrets/action",
       "Microsoft.ApiManagement/service/subscriptions/regeneratePrimaryKey/action",
       "Microsoft.ApiManagement/service/subscriptions/regenerateSecondaryKey/action"
     ],
     "NotActions": [],
     "AssignableScopes": ["/subscriptions/<SUB>"]
   }
   ```

   Assigned at the APIM resource scope, plus `Key Vault Secrets Officer` on the tenants vault and
   `Reader` on the Foundry account — Reader is control-plane only, so the backend still cannot call
   a model. Then `az keyvault network-rule add` for the CDP egress ranges. This is a prerequisite
   for promotion, not an optional cleanup.
4. Tidy up the APIM samples now nothing depends on them: delete `echo-api` and, more importantly,
   the `starter` / `unlimited` products, so no keyless request can match an open product.
5. Docs: dated `**UPDATED**` note in [route1-plan.md](../route1-plan.md);
   [implemented-features.md](../../implemented-features.md) — Route 1 row, the "Mocked external
   integrations" bullet, the new credential-reveal capability, the Last updated line; backend README
   covering the new environment variables, the two-app-registration split, `PROVISIONING_MODE`,
   running against the local file catalogue, and how to add a new credential issuer.
6. Follow-up issues: (i) move Phase 0.5–0.7 into `ai-platform-infra` Bicep; (ii) private
   connectivity from CDP to the tenants Key Vault, removing the IP exception; (iii) migrate the
   stored `apimSubscriptionId` field to `externalId` once a second provider exists.

---

## End-to-end test

The sequence that proves the goal, run against sandbox with `PROVISIONING_MODE=azure`:

```bash
# 1. Catalogue reflects Foundry
curl -s localhost:3001/v1/models | jq '.items[].slug'
#    → matches the deployment names recorded in Phase 0.3

# 2. Issue — a real APIM subscription via ARM
curl -s -X POST localhost:3001/v1/credentials \
  -H 'x-user-id: <id>' -H 'idempotency-key: <uuid>' -H 'content-type: application/json' \
  -d '{"modelSlug":"gpt-4-1","tier":"research","purpose":"e2e test"}'
#    → 201, secret returned once, visible in the APIM blade scoped to /apis/research

# 3. Use it — the whole point
curl -s -X POST "https://<gateway>/research/deployments/gpt-4-1/chat/completions?api-version=2024-05-01-preview" \
  -H "Ocp-Apim-Subscription-Key: <secret>" -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
#    → a model response

# 4. Rotate — the old key stops working, the new one works
curl -s -X PATCH localhost:3001/v1/credentials/<id>/rotate -H 'x-user-id: <id>'

# 5. Revoke — the key stops working
curl -s -X DELETE localhost:3001/v1/credentials/<id> -H 'x-user-id: <id>'
#    → step 3 now returns 401
```

Plus the negative path: a deployment outside `research-allowed-deployments` → 403
`model-not-granted`.

## Relevant files

Backend (`ai-platform-backend-api`):

| File | Change |
|------|--------|
| `src/adapters/credential-issuer.js` | Port: `apimSubscriptionId` → `externalId`; methods unchanged |
| `src/adapters/credential-issuer-registry.js` | **New** — `forModel()` / `forCredential()` |
| `src/adapters/mock-credential-issuer.js` | Stays; must pass the contract suite |
| `src/adapters/azure/{arm-client,apim-credential-issuer,foundry-deployments,key-vault-credential-vault}.js` | New |
| `src/adapters/{catalogue-source,file-catalogue-source,credential-vault,mock-credential-vault}.js` | New |
| `src/adapters/github/github-catalogue-source.js` | New |
| `src/services/credential-service.js` | Registry injection; `issuerKey`; vault wiring; `revealCredential` |
| `src/services/models-service.js` | Query gains the liveness condition |
| `src/services/catalogue-service.js` | New |
| `src/services/maintenance-service.js` | Reconcile `vaultState: 'unwritten'` |
| `src/common/seed/{seed-models.js,models.seed.json}` | Becomes the file-adapter fixture |
| `src/common/backfills/registry.js` | `issuerKey` backfill; catalogue reshape backfill |
| `src/plugins/mongodb.js` | Swap seed call for `syncCatalogue`; index on `lifecycle.status` |
| `src/routes/{credentials.js,maintenance.js}` | Reveal route; sync-catalogue route |
| `src/config.js` | New `armAuth.*` section and the keys below |
| `vitest.config.js` | Exclude the contract-suite helper from coverage |

Frontend (`ai-platform-frontend`):
`src/server/routes/models/`, `src/server/routes/connect/shared/credential/`,
`src/server/routes/manage/credentials/{id}/view/` (new),
`src/server/common/helpers/format-label.js`.

Config: `cdp-app-config/environments/*/defaults.env` — non-secret identifiers only.

## New config keys

Backend `src/config.js`, convict, `UPPER_SNAKE` environment variables. The backend has **no** Azure
config today, so nothing here is a rename — these are all new:

```text
provisioningMode        PROVISIONING_MODE ('mock' | 'azure', default 'mock')

armAuth.tenantId        AZURE_ARM_TENANT_ID
armAuth.clientId        AZURE_ARM_CLIENT_ID
armAuth.clientSecret    AZURE_ARM_CLIENT_SECRET (sensitive, required when mode is 'azure')
armAuth.subscriptionId  AZURE_ARM_SUBSCRIPTION_ID
armAuth.resourceGroup   AZURE_ARM_RESOURCE_GROUP

apim.serviceName        APIM_SERVICE_NAME
apim.researchApiId      APIM_RESEARCH_API_ID (default 'research')
apim.gatewayBaseUrl     APIM_GATEWAY_BASE_URL
foundry.accountName     FOUNDRY_ACCOUNT_NAME
keyVault.tenantsUrl     KEY_VAULT_TENANTS_URL

catalogue.source        CATALOGUE_SOURCE ('file' | 'github', default 'file')
catalogue.repo          CATALOGUE_REPO (default 'DEFRA/ai-platform-infra')
catalogue.ref           CATALOGUE_REF (the pinned release tag)
github.token            GITHUB_TOKEN (sensitive; or the App credentials below)
github.appId            GITHUB_APP_ID
github.installationId   GITHUB_APP_INSTALLATION_ID
github.privateKey       GITHUB_APP_PRIVATE_KEY (sensitive)
```

No certificate key: there is one auth method, a client secret. `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`
and `AZURE_CLIENT_SECRET` are **not** read by the backend — they belong to the SSO registration and
are used by the frontend only.

## Verification

1. `cd ai-platform-backend-api && npm test` — green, coverage not below baseline. New tests:
   `apim-credential-issuer` over `nock`ed ARM including the 502 mapping;
   `key-vault-credential-vault` over nocked Key Vault; `github-catalogue-source` including the 304
   path and "outage keeps last good mirror"; `catalogue-service` upsert / retire / liveness; the
   reveal authorisation matrix (owner succeeds, non-owner 404, revoked refused,
   `vaultState: 'unwritten'` 404); reconcile of an unwritten vault record.
2. `npm run lint && npm run format:check` in both repos.
3. `cd ai-platform-frontend && npm test`.
4. Local: `PROVISIONING_MODE=mock CATALOGUE_SOURCE=file npm run dev` — behaviour unchanged, proving
   the mock path still works.
5. Sandbox, `PROVISIONING_MODE=azure`: `POST /v1/credentials` with `tier: research` → a subscription
   appears in APIM scoped to the `research` API; the response `keyHint` matches its last four
   characters; `az keyvault secret show --name cred-{id}` returns the same value and carries the
   three `aip-*` tags.
6. **Acceptance** — the end-to-end sequence above, in full.
7. `POST /v1/credentials/{id}/reveal` with a reason → the same secret, and an audit event recorded
   with that reason. After `DELETE`, `az keyvault secret show` reports the secret deleted and
   `az keyvault secret list-deleted` still shows it inside the 90-day window.
8. `POST /maintenance/expire-credentials` against an artificially past-due credential → the APIM
   subscription flips to `suspended`.
9. `POST /maintenance/sync-catalogue` → `models` documents carry `catalogueSha` and `release`, and a
   model with no live ARM deployment is not eligible.
10. Grep all logs for the issued key. It must be absent at every level, including error and debug.

## Decisions

- **ARM management plane** (`management.azure.com`, OAuth bearer, Entra-issued), not APIM-authored
  APIs and not the legacy SAS-authenticated `{apim}.management.azure-api.net`. Confirmed with the
  requester 30 Sept 2026.
- All five lifecycle operations are ARM calls behind the unchanged `CredentialIssuer` port.
- **Two separate app registrations**, with the ARM one namespaced `AZURE_ARM_*` so it cannot collide
  with, or be silently substituted for, the SSO registration.
- **Client secret only, no certificates.** One `ClientSecretCredential`, constructed in one place.
- The ARM registration holds Contributor + User Access Administrator on the subscription. Accepted
  for sandbox; Phase 6.3 replaces it with a narrow custom role before promotion.
- `@azure/identity` plus native `fetch` rather than `@azure/arm-apimanagement` — five simple calls,
  no pagination or long-running operations. Contained to `arm-client.js` if it needs to change.
- API-scoped subscriptions, not products, because the design states products are not used.
- Provider registry plus a persisted `issuerKey`, so a future AWS Bedrock issuer needs no change to
  `credential-service.js`.
- Catalogue generated from the real Foundry deployment list, held in `ai-platform-infra`, read via
  Octokit. Phase 4 still adds the ARM liveness check, because the design's availability rule
  requires it. The `file` adapter stays so tests and compose need no network.
- Nightly sync via a token-gated maintenance route plus an on-start sync. No in-process timer.
- Key Vault persistence in scope: a separate `CredentialVault` port; the vault write is non-fatal at
  issue time with reconcile-based recovery; reveal is an audited POST requiring a reason.
- Frontend changes are in scope.
- Phase 0 runs locally against sandbox; CDP configuration is deferred to Phase 6.

## Out of scope

- AWS Bedrock itself — the registry makes it cheap, but no adapter is written here.
- Consumer OAuth / `Model.Invoke`. Research tier callers use an API-scoped subscription key;
  consumer OAuth is the team-tier design and a separate piece of work.
- Team tier `TenantOrchestrator` / GitOps — stays mocked.
- Microsoft Graph `addPassword` team client secrets. The design lists this alongside the APIM path,
  but it is team tier only.
- `ai-platform-tenants` team-file writing.
- Moving APIM configuration into Bicep — follow-up 6.6-i.
- Private CDP → Key Vault connectivity — follow-up 6.6-ii.

## Open dependencies on other people

- **Client ID, secret and tenant ID** for the new ARM app registration. Blocks everything.
- **A hub-connected host** for the gateway curl in 0.8 and the end-to-end test — APIM has a private
  VIP and no public IP. This is the most likely thing to stall the end-to-end run, and worth lining
  up before you reach 0.8 rather than after.
- **CDP egress IP ranges** for the Key Vault firewall — CDP platform team. Phase 6.3 only.

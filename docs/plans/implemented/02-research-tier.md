# 02 Research tier (shared model access)

Personal, time-bound API Management subscription keys for the shared research models. Built against the real
Azure sandbox first (1 to 5 Oct 2026), then moved onto Infrastructure as Code in Infradev (20 Oct 2026). Deployed
to CDP dev on 20 Oct 2026.

| Feature                                                                | Built       |
| ---------------------------------------------------------------------- | ----------- |
| Credential lifecycle: issue, renew, revoke, lazy and scheduled expiry  | Sept 2026   |
| Real Azure issuing through ARM (`CredentialIssuer` port, APIM adapter) | 1 Oct 2026  |
| Key Vault persistence and audited reveal (`CredentialVault` port)      | 2 Oct 2026  |
| Live smoke test against the sandbox (issue, call, reveal, revoke)      | 2 Oct 2026  |
| Portal shows the real gateway request, ineligible models visible       | 5 Oct 2026  |
| Federated backend-to-Azure sign-in (no client secret in CDP)           | 13 Oct 2026 |
| Research tier as Terraform: `research.json`, `research` API            | 20 Oct 2026 |
| Environment-aware backend and portal (`RESEARCH_ENVIRONMENT`)          | 20 Oct 2026 |

## How it works

- A key is an API Management subscription scoped to the `research` API, created through the ARM management plane
  (`src/adapters/azure/`). The backend never calls APIM's own APIs for this.
- The secret is shown once at issue, kept in the tenants Key Vault, and can be revealed again through
  `POST /v1/credentials/{id}/reveal` with a required reason (audited, `Cache-Control: no-store`). Only the last four
  characters (`keyHint`) are stored in MongoDB.
- Keys last 7 days by default (`research.credentialTtlDays`) with a renewal cap. Expiry is enforced three ways: lazy on
  read, by an in-process sweep every five minutes (`credential-expiry-scheduler.js`, token-gated
  `/maintenance/expire-credentials`), and by the API's own policy (`context.Subscription.EndDate`).
- A vault write or expiry update that fails never fails the request: the credential is flagged
  `vaultState: 'unwritten'` and `reconcilePendingCredentials` retries it.
- A retry after a failed issue reuses the failed record instead of adding another, under a per-user-and-model lock.
- Requests are idempotent by `Idempotency-Key`; every state change writes an audit event with no secret in it.

## Environments

- The backend reads the subscription, resource group, API Management instance, tenants vault and Foundry accounts
  from `AIP_ENVIRONMENTS`, chosen by `RESEARCH_ENVIRONMENT` (default `infradev`). Live mode refuses to start when the
  entry is missing or lacks `apimName` or `tenantsVault`. The old flat settings (`AZURE_ARM_SUBSCRIPTION_ID`,
  `AZURE_ARM_RESOURCE_GROUP`, `APIM_SERVICE_NAME`, `AZURE_KEY_VAULT_NAME`) are gone.
- Each credential records its `environment`. Renew, rotate, revoke, reveal and expiry act on **that** environment,
  not the configured one, so a move is configuration plus natural expiry. A credential with no environment counts as
  `sandbox` (backfill `2026-10-20-research-credentials-environment`).
- Issuing is scoped to the target environment: an old key in another environment never blocks a new one.
- The portal shows the gateway host per environment (`GATEWAY_BASE_URLS`) and the environment per credential.
  Infradev is `https://apim-aip-infradev.azure-api.net`; the sandbox stays for old keys.
- The scheduled sweep logs any API Management subscription that is not a `research-*` key on the research API.
- Request shapes through the gateway: `chat-completions` is
  `POST /research/openai/deployments/{deployment}/chat/completions?api-version=2024-05-01-preview`; `responses` is
  `POST /research/openai/responses?api-version=2025-03-01-preview` with the model in the body.

## Infrastructure (Infradev)

- `research.json` in `ai-platform-tenants` is a **platform-owned team file** naming `subscription-key`. The same
  `team` module builds a shared project, account-child deployments named as callers send them, and a `research`
  API that requires a subscription and runs `aip-key-guard`. Applied 20 Oct 2026: 8 added, 0 destroyed.
- It lists `gpt-4o` only: Infradev's Foundry is UK South only and the nano models have no SKU there that the UK or EU
  rule allows. The infra
  coverage check skips a model the environment cannot deploy (infra v0.9.1).
- `aip-checks` accepts a key only in that file and never from a writer App. Terraform creates no subscription.
- The platform root adds the custom API Management role the Portal API needs to mint subscriptions (role
  `7df21b0e-...`, assigned at the API Management resource). The Portal API principal is `26ed72e7-...`
  (`APP-AIE-SND1-aice-platform-portal-api-01`), which is also the CDP backend's federated identity.
- The hand-built sandbox resources (`SNDAIEEXPRGP1401`, `DEPLOYTESTDEFRA`, `kv-aip-sandbox-tenants`,
  `sndaieinfst1401aiefoundry`) are kept only for keys issued before the move.

## Verified live

- Sandbox: issue, a real gateway completion, reveal and revoke (2 Oct 2026). It found one real bug: ARM `DELETE`
  returns `200` with an empty body, which crashed revoke; fixed with a regression test.
- Infradev (20 Oct 2026, from CDP dev): issue, reveal, renew and delete a research key; a team deployment applied.

## Not in this tier

Team secrets, GitOps team provisioning and the progress page are in [03 Team tier](03-team-tier.md). Outstanding
research work (end-to-end journey test, ARM liveness reconcile, narrower Azure roles) is in
[../remaining.md](../remaining.md).

# 04 Catalogue and gateway

Where models come from, how they are described, and how every one is reached through Azure API Management. Built
1 to 9 Oct 2026; rolled out to CDP dev on 20 Oct 2026 (backend `0.43.0`, catalogue `v0.9.1`).

| Feature                                                             | Built       |
| ------------------------------------------------------------------- | ----------- |
| `CatalogueSource` port, `file` and `github` adapters, sync on start | 1 Oct 2026  |
| Real catalogue content in `ai-platform-infra` (`catalogue/`)        | 1 Oct 2026  |
| Gateway-first catalogue: offerings with `hosting` and `gateway`     | 9 Oct 2026  |
| Team tier in the catalogue (`v0.7.0`), research eligibility         | 15 Oct 2026 |

## Catalogue

- `ai-platform-infra` holds `catalogue/providers/` and `catalogue/models/` with `catalogue/schema/`; the backend reads
  it at a pinned release tag (`CATALOGUE_REF`, now `v0.9.1`). A catalogue change needs an infra release and the
  backend's `CATALOGUE_REF` moved, then a backend restart.
- `CATALOGUE_SOURCE=github` (Octokit, ETag caching, last-good-mirror fallback on any failure) or `file` (the seed
  files, so tests and compose need no network).
- Synced into MongoDB on every start (`syncCatalogue`, with `catalogueSha`, `release`, `syncedAt`). A model missing from
  the source is retired (`eligible: false`, `lifecycle.status: 'retired'`), never deleted. An empty result skips the
  sync rather than retiring everything.
- Each model's `apiProfile` (`chat-completions` or `responses`) drives the portal's gateway URL shape and the backend's
  `apiVersion` default (`responses` is pinned to `2025-03-01-preview`).
- The catalogue pages show ineligible and retired models greyed out with their reason
  (`GET /v1/models?includeIneligible=true`, browse page only).

## Gateway

- Every model is reached through Azure API Management, whichever cloud hosts it. A model's `hosting` (`platform`:
  `foundry`, `bedrock` or `direct`) says where it runs; it is not a gateway. The offering's `gateway` (today only
  `azure-apim`) selects the issuer and vault.
- A model contradicting its offering, or naming an unknown one, is skipped. `adapter` was renamed `gateway` throughout,
  except the backend's `src/adapters/` folder, where it is the design-pattern term.
- `PROVISIONING_MODE` is `mock` or `live`. In `live`, `ENABLED_GATEWAYS` lists what the environment runs; a model on
  another gateway gets `501 gateway-not-enabled`. `MOCK_TIERS` keeps named tiers on the mocks and is refused in prod.
- A credential records the `issuerKey` that minted it, and its renew, rotate, revoke and reveal use that issuer and its
  matching vault.
- No Bedrock offering ships yet. A new gateway needs an issuer and vault adapter in the two registries and its config
  keys in `REQUIRED_CONFIG_BY_GATEWAY`; the services do not change.

## Where the code is

- Backend: `src/adapters/catalogue-source.js` (port), `file-catalogue-source.js`, `github/github-catalogue-source.js`,
  `src/services/catalogue-service.js`, `credential-issuer-registry.js`, `credential-vault-registry.js`.
- Frontend: `src/server/common/helpers/gateway-request.js`, the model table component.
- Design: `ai-platform-discovery-docs` design C (orchestration) and the decision history.

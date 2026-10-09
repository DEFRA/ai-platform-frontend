# Centralised gateway: APIM-only, offering-derived hosting

> Cross-cutting plan, not a journey route. See also the
> ["three routes to a credential"](../../ui-flow-three-routes.md) journey
> ([Route 0](../route0-welcome-plan.md), [Route 1](../route1-plan.md), [Route 2](../route2-plan.md),
> [Route 3](../route3-plan.md)) and the other cross-cutting plan,
> [research-tier-integration-plan.md](../integration/research-tier-integration-plan.md).
>
> Source proposal: [new-shape.md](new-shape.md).
>
> **STATUS: COMPLETE (9 Oct 2026).** Phases R, A, B, C, D, E, F, G, H and I are all done. What
> remains is rollout, not plan work: merge and release the backend (18), frontend (17) and
> discovery-docs (15) pull requests, deploy the backend to `dev`, then merge the draft
> `cdp-app-config` pull request (4820) that moves the dev `CATALOGUE_REF` to `v0.2.0`. Until then
> no environment pin has moved from `v0.1.2`. Update this line as each
> phase lands (`Phase A complete`, etc.) and add a dated note at the bottom recording what actually
> happened versus what is written here.
>
> **UPDATED 9 Oct 2026 — no legacy support, by direction:** the site is not live, so the backend reads
> only the `hosting`/`gateway` shape and keeps no legacy fallback (`LEGACY_CLOUD`, `legacyHosting`,
> flat or plain-string offerings, model `cloud`/`adapter` input, `model-hosting.js`). This supersedes
> constraint 2, B1, B3-B5, C1 and verification step 8b below. An offering without `hosting`/`gateway`
> skips the sync; `v0.1.x` can no longer be pinned.
>
> **RECHECKED 9 Oct 2026 against `ai-platform-discovery-docs` PR #14** (`7a60b71`, the
> `docs/repo-drift-cleanup` branch). The schema mandate is unchanged, but Phase I shrank sharply —
> that PR already did most of it — and two new constraints landed. See "Drift check, 9 Oct 2026" at
> the bottom for the full comparison.

## The principle

Every model is exposed through Azure API Management, whatever cloud hosts it. APIM is the only
gateway today, but the catalogue keeps `gateway` as an explicit field so it can change later.

Hosting varies; the gateway does not. Models are hosted on Microsoft Foundry now. Amazon Bedrock
and direct provider APIs (OpenAI, Anthropic, Meta) may follow post-MVP. **Bedrock and direct APIs
are hosting platforms behind APIM. They are not new gateways or credential adapters.** Credentials
are always issued by APIM and stored in Key Vault.

It is one credential journey to the gateway; the gateway manages the behind-the-scenes credentials.
Three-legged OAuth is a later question.

## Authoritative source

`ai-platform-discovery-docs` at `main` = `7a60b71` (PR #14, 8 Oct 2026). Line numbers below are
from that commit — PR #14 added `ms.date` frontmatter to every content page, which shifted every
earlier citation by one line.

| Reference                                                                                                                            | What it mandates                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [design-orchestration.md](../../../../ai-platform-discovery-docs/src/content/design-orchestration.md) L162-191 `{#catalogue-schema}` | The provider/offering field table. L185: "Model files do not repeat `cloud` or `adapter`; the backend derives both from the offering". L187 PR checks, L189 extension rules                                                                                                                                                  |
| Same file L191                                                                                                                       | **The backend must read both shapes.** "`ai-platform-infra` `v0.1.2` ships one provider file in the earlier flat shape … and backend `0.24.0` reads that shape. The shape above replaces it without changing the fields mirrored onto models and credentials, so the backend reads both until a catalogue release adopts it" |
| Same file L193-208 `{#catalogue-flow}`                                                                                               | "Credential issuer and vault registries keyed by the offering's `gateway`, never by cloud or platform"                                                                                                                                                                                                                       |
| Same file L382                                                                                                                       | Constraint 10: confirm how APIM authenticates to Amazon Bedrock before any `bedrock` offering ships                                                                                                                                                                                                                          |
| [catalogue.md](../../../../ai-platform-discovery-docs/src/content/catalogue.md) `{#availability}`                                    | Added by PR #14. The same direction in user-facing terms: "The catalogue lists model providers such as OpenAI, Anthropic or Meta; each provider's offerings are its hosting routes… A hosting route is never a separate gateway, and team credentials are always gateway credentials"                                        |
| [decision-history.md](../../../../ai-platform-discovery-docs/docs/decision-history.md) 8 Oct 2026 entry                              | "Adopting the new shape is application and catalogue work outside this site" — i.e. this plan. Its **Open** section now adds: "Move `ai-platform-infra`'s catalogue and the backend sync to the `hosting` and `gateway` shape **together**, and add `catalogue/schema/`"                                                     |
| [cloud-designs.json](../../../../ai-platform-discovery-docs/src/data/cloud-designs.json) AR03 v0.6.0                                 | "Bedrock and direct provider APIs are hosting platforms behind API Management, never separate gateways or credential issuers", and the control "team credentials stay gateway credentials"                                                                                                                                   |

The design pack matches [new-shape.md](new-shape.md) on every field name and enum. It ships neither
the JSON Schema nor any example provider JSON; those exist only in `new-shape.md`.

Two constraints follow from the table above and shape the sequencing:

1. **Phases A and B ship together.** The decision history asks for the catalogue and the backend
   sync to move "together". A catalogue release in the new shape read by a backend that only
   understands the old one — or the reverse — is a broken environment, since the pinned
   `CATALOGUE_REF` is per environment.
2. **The backend reads both shapes, permanently enough to matter.** Not every environment moves its
   pin at once, so B1 and B3 must keep accepting a flat `v0.1.x` offering indefinitely rather than
   as a short-lived migration courtesy. This is about catalogue _input_ only; the Mongo documents it
   writes are nested-only (decision 2).

## Target shape

Provider file, `catalogue/providers/{id}.json`:

```json
{
  "$schema": "../schema/provider.schema.json",
  "id": "openai",
  "displayName": "OpenAI",
  "offerings": [
    {
      "id": "azure-openai",
      "displayName": "OpenAI on Microsoft Foundry",
      "hosting": { "platform": "foundry", "cloud": "azure" },
      "gateway": "azure-apim",
      "terms": "https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy"
    }
  ]
}
```

| Offering field      | Rule                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `displayName` | `id` unique within the provider; what a model's `offering` names. Existing ids such as `azure-openai` stay, because issued credentials record them |
| `hosting.platform`  | `foundry`, `bedrock` or `direct`                                                                                                                   |
| `hosting.cloud`     | `azure` for `foundry`, `aws` for `bedrock`; absent for `direct`                                                                                    |
| `hosting.provider`  | Who runs a `direct` API; absent on cloud platforms, where the cloud names the host                                                                 |
| `gateway`           | Required. `azure-apim` is the only value. Selects the credential issuer and vault                                                                  |
| `terms`             | Optional link, per offering because terms differ by hosting route                                                                                  |

Persisted model document (Mongo) — **nested only, no flat `cloud`/`adapter`**:

```js
{
  provider: 'openai',
  offering: 'azure-openai',
  hosting: { platform: 'foundry', cloud: 'azure', provider: null },
  gateway: 'azure-apim'
}
```

Persisted credential document — stays **flat**, with the field renamed to match the model:

```js
{ provider, offering, cloud: 'azure', gateway: 'azure-apim', issuerKey: 'mock' }
```

So `gateway` names the same thing everywhere — the catalogue offering, the model document, the
credential document, the config keys and the code. The word "adapter" survives in exactly one
place: the `src/adapters/` folder, where it is the ports-and-adapters design-pattern term rather
than a description of what a gateway is.

## Confirmed decisions

1. **Scope**: `ai-platform-backend-api` + `DEFRA/ai-platform-infra` + `ai-platform-frontend` (docs
   _and_ the model-page caption) + a separate discovery-docs PR for build story B04.
2. **Model documents carry the nested object only.** The legacy flat `cloud`/`adapter` are removed,
   not kept as a fallback. Safe to contract in one step because `azure-apim` is the only gateway
   that exists, so a pre-backfill document resolves to the value it already had.
3. `hosting.platform` and `hosting.provider` are persisted now, inside that same object, so a future
   `bedrock`/`direct` offering needs no further schema change.
4. **Credential documents are not nested**, but `adapter` is renamed to `gateway`, matching the
   catalogue and the model document. The design pack says credential fields are unchanged by the
   new shape; only the naming improves.
5. **`adapter` → `gateway` everywhere it means "the gateway we issue credentials through"** —
   `DEFAULT_GATEWAY`, `provisioning.gateways`, `ENABLED_GATEWAYS`, `REQUIRED_CONFIG_BY_GATEWAY`,
   `gateway-keys.js`, `gatewayName`, and the loop variables and comments around them. There is no
   `gatewayAdapter` identifier anywhere; a gateway is a gateway.
   The one exception is the hexagonal ports-and-adapters sense, which keeps the word because it is
   a design-pattern term, not a description of a gateway: `src/adapters/`, the `#/adapters/*`
   import alias, `catalogue-source.js`, `file-catalogue-source.js`, `github-catalogue-source.js`,
   `tenant-orchestrator.js`, `arm-client.js`, `azure-credential.js` and their generic "adapter"
   JSDoc all stay as they are. The backend's own `copilot-instructions.md` describes that folder as
   ports and adapters, and a catalogue source is not a gateway at all.
6. Error code `adapter-not-enabled` → `gateway-not-enabled`. Verified safe: no frontend
   `errorMessageForCode` map contains it (`connect/controller.js`, `connect/team-controller.js` and
   `teams/controller.js` are the only three maps, and none list it).

## Phases

### R. Rename `adapter` → `gateway`

**COMPLETE 9 Oct 2026** — see "Phase R implementation notes" at the bottom.

One mechanical commit, before any behaviour change, so the later diffs are about the design rather
than about naming. The suite must pass with only renamed identifiers.

- **R1.** `src/adapters/adapter-keys.js` → `src/adapters/gateway-keys.js`;
  `DEFAULT_ADAPTER` → `DEFAULT_GATEWAY`; `AZURE_APIM` unchanged. Four import sites:
  `config.js` L5, `credential-issuer-registry.js` L4, `credential-vault-registry.js` L4,
  `catalogue-service.js` L2.
- **R2.** `src/config.js`: `provisioning.adapters` → `provisioning.gateways`; env
  `ENABLED_ADAPTERS` → `ENABLED_GATEWAYS`; `REQUIRED_CONFIG_BY_ADAPTER` →
  `REQUIRED_CONFIG_BY_GATEWAY`; both throw messages at L400/L408.
  **Verified no deployed config sets `ENABLED_ADAPTERS`** — the only CDP env file,
  `cdp-app-config/services/ai-platform-backend-api/dev/ai-platform-backend-api.env`, sets
  `PROVISIONING_MODE=azure` and nothing else. No deprecated alias needed; re-check that file before
  merging anyway.
- **R3.** `credential-issuer-registry.js` / `credential-vault-registry.js`: loop variable
  (`adapter` → `gateway`), the `issuerFactories`/`vaultFactories` comments, and the error code at
  L34 / L24 → `gateway-not-enabled`.
- **R4.** `src/adapters/credential-issuer-contract.js`: `adapterName` → `gatewayName`. The
  parameter names which gateway the suite is running against, so `gateway` is the accurate word.
- **R5.** `src/services/credential-service.js` L228/L232: the `adapter-not-enabled` catch/rethrow.
- **R6.** Credential document field `adapter` → `gateway`: the write at L358, and the index
  `{ adapter: 1, status: 1 }` → `{ gateway: 1, status: 1 }` at `src/plugins/mongodb.js` L174
  (dropping the superseded index, as this repo already does elsewhere) plus its L173 comment.
- **R7.** New backfill `2026-10-08-credentials-gateway`: pipeline `updateMany` on the
  **credentials** collection, `{ gateway: { $exists: false } }`, `$set: { gateway: '$adapter' }`.
  Expand step only: `adapter` is **not** unset, because an older instance still serving during a
  rolling deploy keeps writing `adapter`; the later contract migration re-copies any document still
  missing `gateway`, then unsets `adapter`. Append **after** the two shipped `2026-10-07-*` entries (they query
  `{ adapter: { $exists: false } }` and would re-create the old field if they ran later) and
  **before** D1. Note D2 uses the same `{ gateway: { $exists: false } }` filter on the **models**
  collection — different collections, so the two do not interact.
- **R8.** Tests: `config.test.js` L30/L42-65, both registry tests, `credential-service.test.js`
  L123-151, `routes/credentials.test.js` L46/L567, and a new `backfills/registry.test.js` case for
  R7. The two 2026-10-07 tests keep the old field name — they assert historical documents.
- **R9.** `README.md`: env table L244/L267, and the "Gateways and adapters" heading → "Gateways".

### A. Catalogue repo `DEFRA/ai-platform-infra`

Not in this workspace; clone it. Current pinned release `v0.1.2` → new release **`v0.2.0`**.

- **A1.** Add `catalogue/schema/provider.schema.json` — the schema in [new-shape.md](new-shape.md):
  `additionalProperties: false`, id pattern `^[a-z0-9]+(-[a-z0-9]+)*$`, the `oneOf` hosting
  discriminator (foundry+azure, bedrock+aws, direct+provider-and-no-cloud), `terms` matching
  `^https://`. The folder is already excluded from sync by `isCatalogueJson` in
  `github-catalogue-source.js` L46-53.
- **A2.** Add (or amend) `catalogue/schema/model.schema.json` so `cloud` and `adapter` are rejected
  — a model declaring them should fail the pull request check, not be silently ignored.
- **A3.** Reshape `catalogue/providers/openai.json` to the target shape above. Keep the offering id
  `azure-openai`.
- **A4.** Drop `cloud` and `adapter` from all 8 `catalogue/models/*.json`.
- **A5.** Ship **no `bedrock` offering**. Design pack constraint 10 (how APIM authenticates to
  Bedrock without long-lived AWS keys) is unresolved, so the schema permits `bedrock` but nothing
  uses it. Record that in the catalogue README.
- **A6.** Tag `v0.2.0`. Do **not** bump `CATALOGUE_REF` in any environment until Phase B has merged
  — the decision history asks for the catalogue and the backend sync to move **together**, and the
  pin is per environment, so a new-shape release read by an old backend breaks that environment.
  Sequence: merge B → tag `v0.2.0` → move pins one environment at a time.

### B. Backend sync — `src/services/catalogue-service.js`

Depends on R; can run in parallel with A, but **ships before** A's tag is pinned anywhere.

The design pack requires the backend to read **both** offering shapes, not to migrate off the old
one: environments move their `CATALOGUE_REF` independently, so a flat `v0.1.x` offering must keep
working for as long as any environment pins one. Treat the legacy branches in B1 and B3 as
permanent code, not scaffolding to delete later.

- **B1.** `indexOfferings` (L18-33): the indexed value becomes the offering object. Legacy string
  offerings synthesise `{ id, hosting: { platform: 'foundry', cloud: LEGACY_CLOUD, provider: null },
gateway: DEFAULT_GATEWAY }`; a legacy flat `{ id, cloud, adapter }` offering from a
  v0.1.x release is lifted into the same nested shape.
- **B2.** A duplicate offering id within a provider logs an error and **skips the whole sync**
  (`{ synced: 0, retired: 0, skipped: true }`), mirroring the zero-models guard at L85-91.
  _Deliberate deviation_ from new-shape.md's "fail the sync": throwing would propagate into
  `mongodb.js` startup, whereas skipping keeps the last good copy — the philosophy this file
  already follows everywhere else.
- **B3.** `normalizeModel` (L43-55): the **offering now wins over the model**. Emits
  `hosting: { platform, cloud, provider }` and `gateway`. Falls back to a raw model's own flat
  `cloud`/`adapter` only as catalogue-_input_ tolerance for a stale v0.1.x release, then to
  `LEGACY_CLOUD` / `DEFAULT_GATEWAY`. Never emits flat fields.
- **B4.** The mismatch check at L113-123 now only fires when the raw model still _declares_ flat
  `cloud`/`adapter`, compared against `offering.hosting.cloud` / `offering.gateway`.
- **B5.** The model upsert (L125-137) gains `$unset: { cloud: '', adapter: '' }` alongside its
  `$set`. Without this, `$set: { ...model }` leaves the old flat values on an already-synced
  document forever.
- **B6.** The unknown-offering skip (L104-111) and the providers upsert (L141-148) are unchanged.

### C. Backend consumers

- **C1.** New `src/common/model-hosting.js` exporting `gatewayOf(model)`
  (`model.gateway ?? DEFAULT_GATEWAY`) and `hostingOf(model)`
  (`model.hosting ?? { platform: 'foundry', cloud: LEGACY_CLOUD, provider: null }`). No flat-field
  fallback, per decision 2. Lives in `src/common/` so both the adapters and services layers can
  import it without an adapter → service dependency. Precedent:
  `externalGatewaySubscriptionIdOf` in `credential-service.js`.
- **C2.** `src/adapters/credential-issuer-registry.js` L50 → `resolve(gatewayOf(model))`. Rewrite
  the L13-16 comment: Bedrock is a hosting platform behind APIM, not a gateway; the extension point
  is a new gateway.
- **C3.** `src/services/credential-service.js` L356-358 → `cloud: hostingOf(model).cloud ?? null`,
  `gateway: gatewayOf(model)`.
- **C4.** Same file, the snapshot comment around L351-353: record why `gateway` and
  `issuerKey` both exist — `gateway` is what the catalogue said at issue time, `issuerKey` is
  which issuer actually minted it, and they differ whenever `provisioning.mode` is `mock` or the
  tier is listed in `mockTiers`. One line, no code change.
- **C5.** `src/adapters/credential-vault-registry.js` L6-13: delete "a Bedrock credential's secret
  goes to AWS while an Azure one goes to Key Vault". Every secret goes to Key Vault.
- **C6.** `src/adapters/gateway-keys.js` L1 (renamed in R1): "Catalogue `adapter` ids" →
  gateway ids.

### D. Backfill and indexes

Follows [`schema-changes.instructions.md`](../../../../ai-platform-backend-api/.github/instructions/schema-changes.instructions.md).

- **D1.** New entry appended to the **end** of `src/common/backfills/registry.js`:
  `2026-10-08-models-hosting-gateway`. **The final registry order is load-bearing**:
  `2026-10-07-models-cloud-adapter-default` → `2026-10-07-credentials-provider-cloud-adapter` (both
  read or write the flat model fields) → R7's `2026-10-08-credentials-gateway` → D1. Any
  other order lets an earlier entry re-create a field a later one removed.
- **D2.** A single aggregation-pipeline `updateMany` on `{ gateway: { $exists: false } }`:
  `$set` `hosting: { platform: 'foundry', cloud: { $ifNull: ['$cloud', 'azure'] }, provider: null }`
  and `gateway: { $ifNull: ['$adapter', 'azure-apim'] }`, then `$unset: ['cloud', 'adapter']`.
- **D3.** Leave both shipped `2026-10-07-*` backfills untouched — historical and idempotent.
- **D4.** `src/plugins/mongodb.js`: no new models index (nothing queries models by
  `hosting`/`gateway`). The existing models `{ provider: 1, offering: 1 }` at L113 stays; the
  credentials index is renamed in R6. **Delete the stale shape comment at L41-44**, which describes
  exactly the shape being replaced.

### E. Seed, fixtures and tests

- **E1.** `src/common/seed/providers.seed.json` → the new offering shape, mirroring A3.
- **E2.** `src/common/seed/models.seed.json` → drop `cloud`/`adapter` from all 8 entries (`adapter`
  at lines 8, 61, 114, 167, 224, 273, 331, 389, and the `cloud` line above each).
- **E3.** `src/services/catalogue-service.test.js`: rewrite L170-204 so it derives the nested shape
  from a `bedrock`-platform offering whose `gateway` is still `azure-apim` — **not** `aws-bedrock`.
  L207-236 (legacy string offerings) keeps passing but asserts the nested shape; L239-271 becomes
  the legacy-flat mismatch case; L274-302 unchanged. New cases: a duplicate offering id skips the
  sync; a `direct` offering yields `hosting.provider` set and `hosting.cloud` null; a
  previously-synced document with flat fields has them removed after a re-sync (B5).
- **E4.** `credential-issuer-registry.test.js` / `credential-vault-registry.test.js`: replace the
  `aws-bedrock` fixtures with a plausible second _gateway_ id (not a cloud), e.g.
  `aws-apigw`, and switch model fixtures from `adapter:` to `gateway:`.
- **E5.** `src/config.test.js` L48-65: the same id swap, on top of R8's rename.
- **E6.** `src/services/credential-service.test.js` L123-151: the model fixture uses
  `gateway: 'aws-apigw'` to trigger `501 gateway-not-enabled`.
- **E7.** `src/common/backfills/registry.test.js`: a new D1/D2 case (flat in → nested out, flat
  gone, and a document that already has `gateway` left untouched). The two 2026-10-07 tests keep
  their `aws-bedrock` data and old field names — they assert historical documents those backfills
  deliberately leave alone.
- **E8.** `src/routes/credentials.test.js` L43-48 / L562-568: `gateway: 'azure-apim'` per R8.
  No nesting — the credential document stays flat.
- **E9.** `github-catalogue-source.js` and its test need no change: shape-agnostic pass-through, and
  `catalogue/schema/` is already excluded.

### F. Backend prose

- **F1.** `src/config.js` L190 (the `provisioning.mode` doc), L196 (the `gateways` doc) and
  L351-353 ("A new gateway (e.g. aws-bedrock)") — reword to gateway language with a
  non-cloud example.
- **F2.** `README.md` L239-255, now "Gateways": rewrite around the principle. Every model is
  reached through APIM whatever cloud hosts it; `hosting.platform` (`foundry`/`bedrock`/`direct`) is
  not a gateway; `ENABLED_GATEWAYS` lists gateways, default and only value
  `azure-apim`. Note A5's Bedrock blocker and the environment variable rename.

### G. Frontend code

Can run in parallel with B-F; only needs B3's field names.

- **G1.** `src/server/routes/models/controller.js` L160: replace the hardcoded
  `` `${formatLabel(model.provider)}, hosted by Defra in ${formatLabel(model.region)}` `` with a
  local `hostingCaptionFor(model)`:
  - `hosting.platform === 'direct'` → "{Provider}, hosted by {hosting.provider}"
  - otherwise (`foundry`, `bedrock`) → "{Provider}, hosted by Defra in {region}" as today
- **G2.** Same file, `buildModelSummaryRows` L78-83 ("Where it runs"): a `direct` model shows
  "{dataZone} data zone" only. Per design pack L186, a model under a `direct` offering still
  declares `dataZone` where `regions[]` does not apply.
- **G3.** `src/server/common/components/model-table/template.njk` L30: the "Where it runs" cell
  falls back to `model.dataZone` when `model.region` is absent. The `colspan="3"` on the ineligible
  branch is unaffected.
- **G4.** `src/config/nunjucks/filters/format-label.js`: add `meta: 'Meta'` (openai and anthropic
  are already there) so a `direct` offering's `hosting.provider` renders. Do **not** add
  `foundry`/`bedrock`/`azure`/`aws` — people do not need to see the hosting plumbing, which is the
  whole point of the principle.
- **G5.** Tests: `models/controller.test.js` gains a `direct`-offering fixture asserting both the
  caption and the region-less "Where it runs" row; `model-table/template.test.js` gains a
  region-less fixture; `format-label.test.js` gains `meta`.
- **G6.** Deliberately **not** changed: `gateway-request.js` (its APIM path shape is keyed off
  `apiProfile` and is correct by design under an APIM-only gateway), `code-examples/template.njk`'s
  hardcoded `Ocp-Apim-Subscription-Key` header (likewise now correct by design), and the hardcoded
  provider filter in `models/index.njk` (only OpenAI exists).

### H. Frontend docs

- **H1.** [`docs/implemented-features.md`](../../implemented-features.md) L10 (the "multi-cloud
  catalogue: models carry `cloud`/`adapter` … chosen per adapter via `ENABLED_ADAPTERS`" header
  line), L99-110, L102-104, L112-125, L131-137. Mandatory per
  `implemented-features.instructions.md` once R and B-G land. Note this file is not just internal:
  `build-stories.md#status` in the design pack cites it as "the running record" of built state, so
  leaving it stale propagates the error into the design pack at the next read.
- **H2.** [`docs/plans/integration/research-tier-integration-plan.md`](../integration/research-tier-integration-plan.md):
  a dated STATUS note, plus fixes at L189-206 (the canonical statement of the old shape),
  L197-199 (`ENABLED_ADAPTERS`), L354, L764, L815-848, L894-904, L1112-1123, L1143.
- **H3.** [`docs/plans/route1-plan.md`](../route1-plan.md) L148 ("Bedrock/Anthropic-style entries
  greyed" — provider framing) plus a note that G1/G2 landed. Light pointer notes only on Route 2
  and Route 3.
- **H4.** [`docs/ui-flow-three-routes.md`](../../ui-flow-three-routes.md) L101-102, the stale
  "APIM adapter blocked on D01".

### I. Discovery docs

**COMPLETE 9 Oct 2026** — see "Phase I and rollout notes" at the bottom.

A separate, doc-only pull request in `ai-platform-discovery-docs`, raised **after** R-G land,
because every remaining item reports built state and must be read from the merged code.

**Already done by PR #14 (8 Oct 2026) — do not redo:**

- ~~Rewrite B04 so Bedrock/Anthropic/Foundry are not providers with an approval `status`.~~ Done.
  B04 now carries a "Rewritten on 8 October 2026" note, drops the provider-status acceptance
  criteria, and replaces the seed-file flow with the `CatalogueSource` mirror.
- ~~Drop the `GET /v1/providers` claim.~~ Done — B04's Repositories row no longer lists it.
- ~~Leave `cloud-designs.json` alone.~~ Superseded. AR03 was advanced to **v0.6.0** with the 8 Oct
  direction and a reworded control ("team credentials stay gateway credentials"). Nothing further
  is needed there unless a _later_ decision changes it.
- ~~`docs/mvp-portal-ui-api-scope.md`.~~ Deleted by PR #14; no longer a consideration.

**Still outstanding — all of it is "report the built state once this plan ships":**

- **I1.** `build-stories.md` B04 state row still describes the flat shape: "each offering names its
  `cloud` and `adapter` … offerings use the flat shape that design C replaces with `hosting` and
  `gateway`". Once A and B land, that caveat is resolved and the row should say so.
- **I2.** `build-stories.md` B05 state row names **`ENABLED_ADAPTERS`**, and gap 4 names
  `MOCK_TIERS`. Phase R renames the first to `ENABLED_GATEWAYS`, so B05 goes stale the moment R
  merges. This is the one item that is _caused by_ this plan rather than fixed by it.
- **I3.** `design-orchestration.md` L191's "Built by 8 October 2026" note says `v0.1.2` ships the
  flat shape with no `catalogue/schema/`, and that backend `0.24.0` reads it. After A and B this
  needs a fresh dated read: the new tag, the schema folder, and the backend reading both shapes.
- **I4.** `#catalogue-flow` L208 and the `## Build status` section (`{#status}`, currently "on
  8 October 2026", read from backend `0.24.0` / frontend `0.19.0` / infra `v0.1.2`) need the same
  re-read against whatever versions this work ships as.
- **I5.** Follow that repo's **`.github/copilot-instructions.md`**, added by PR #14 — it is stricter
  than the `design-pack.instructions.md` pointer this plan previously cited. Every change must:
  sweep the repository for contradicted statements, delete what it supersedes, set `ms.date` on
  each Markdown file touched, append a dated entry to `docs/decision-history.md`, version any
  changed AR/D record, update `docs/design-pack-plan.md`, pin the new copy in `test/site.test.js`
  (with an `assert.doesNotMatch` for the superseded wording), and run `npm run lint`, `npm test`
  and `npm run check`.

## Verification

1. `npm test`, `npm run lint` and `npm run format:check` in `ai-platform-backend-api` (baseline
   204/204, plus the new cases). **Phase R alone must be green before Phase B starts.**
2. Targeted:
   `npx vitest run src/services/catalogue-service.test.js src/adapters/credential-issuer-registry.test.js src/adapters/credential-vault-registry.test.js src/common/backfills/registry.test.js src/config.test.js src/routes/credentials.test.js`
3. `grep -rn "aws-bedrock" src/` in the backend returns only the two historical 2026-10-07 backfill
   tests. `grep -rn "model\.adapter\|model\.cloud" src/` returns nothing.
   `grep -rn "ENABLED_ADAPTERS\|DEFAULT_ADAPTER\|adapter-not-enabled" .` returns nothing outside
   those same historical backfills.
4. **Rename boundary check**: `grep -rni "gatewayadapter\|gateway-adapter\|gateway_adapter" .`
   returns **nothing at all** — that spelling was considered and rejected, so finding one means a
   stale edit. Then `grep -rn "adapter" src/` should return hits only under `src/adapters/`
   (the ports-and-adapters folder and its JSDoc), the `#/adapters/*` import specifiers, and the two
   historical 2026-10-07 backfills. Any `adapter` hit in `src/services/`, `src/routes/`,
   `src/common/seed/` or `src/config.js` is a miss.
5. Local file source: `npm run dev`, then `GET /v1/models/gpt-4-1-nano` shows
   `hosting: { platform: "foundry", cloud: "azure", provider: null }`, `gateway: "azure-apim"`, and
   **no** top-level `cloud` or `adapter`.
6. Backfill proof: insert a legacy-shaped model document (`cloud: 'azure'`,
   `adapter: 'azure-apim'`, no `gateway`) and a legacy-shaped credential document
   (`adapter: 'azure-apim'`, no `gateway`) into a local Mongo, restart, and confirm both gain
   `gateway`; the model loses `cloud`/`adapter`, the credential keeps `adapter` (expand step).
7. Index proof: `db.credentials.getIndexes()` shows `{ gateway: 1, status: 1 }` and no
   `{ adapter: 1, status: 1 }`.
8. Real GitHub source: `CATALOGUE_SOURCE=github CATALOGUE_REF=v0.2.0 GITHUB_TOKEN=…` — the user runs
   this, since the agent cannot see their `.env`. Confirm 8 models synced, 0 skipped.
   8b. **Dual-shape proof** (required by design C L191): re-run step 8 against the _old_ tag,
   `CATALOGUE_REF=v0.1.2`, and confirm it also syncs 8 models with 0 skipped, writing the same
   nested documents from the flat offering. An environment that has not moved its pin must keep
   working.
9. Issue a research credential in mock mode; the credential document has flat `cloud: "azure"`,
   `gateway: "azure-apim"`, `issuerKey: "mock"`.
10. `npm test` in `ai-platform-frontend` green (baseline 213/213, plus G5). Manually,
    `/models/gpt-4-1-nano` still reads "OpenAI, hosted by Defra in UK South".
11. `npm run lint`, `npm test` **and `npm run check`** in `ai-platform-discovery-docs` after Phase
    I — that repo's instructions require `check` whenever sections, anchors, diagrams, links or
    assets change, and `test/site.test.js` pins expected copy, so a reworded sentence fails the
    suite until the assertion is updated with it.
12. Re-check `cdp-app-config/services/ai-platform-backend-api/dev/ai-platform-backend-api.env`
    still does not set `ENABLED_ADAPTERS` before merging R2.

## Scope boundaries

- No anthropic, meta, bedrock or direct offering is created — only the schema that permits them.
- Credential documents are not nested; only the one field is renamed, to `gateway`.
- There is no `gatewayAdapter` identifier anywhere — not in config, code, or any document.
- `src/adapters/`, the `#/adapters/*` alias and every ports-and-adapters file in it keep the word
  "adapter", because there it is the design-pattern term rather than a word for a gateway.
- `gateway-request.js`'s APIM URL shape, the `models/index.njk` provider filter and the
  `code-examples` authentication header are untouched.
- No change to `github-catalogue-source.js`, `file-catalogue-source.js` or any route handler beyond
  what the field rename forces.

## Open after this plan

Design pack constraint 10: confirm how API Management authenticates to Amazon Bedrock without
long-lived AWS access keys, before any `bedrock` offering ships. Out of scope here, and the reason
A5 ships no such offering.

## Drift check, 9 October 2026

Rechecked against `ai-platform-discovery-docs` PR #14 (`docs/repo-drift-cleanup`, merged as
`7a60b71`), which landed after this plan was written. Two commits: `551ea2b` swept repository drift,
dated every page and removed superseded documents; `88b303a` aligned the catalogue page and story
B04 with hosting routes.

**Unchanged, so the core of this plan still holds.** The `{#catalogue-schema}` mandate — the
provider/offering field table, the `hosting`/`gateway`/`terms` rules, "Model files do not repeat
`cloud` or `adapter`", the PR checks and the extension rules — is word-for-word the same. So is
`{#catalogue-flow}`'s "registries keyed by the offering's `gateway`, never by cloud or platform",
and constraint 10. Phases R, A, B, C, D, E, F, G and H are unaffected.

| What changed                                                                                                                                           | Effect on this plan                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ms.date` frontmatter added to every content page                                                                                                      | Every line citation shifted by one. The Authoritative source table has been re-read against `7a60b71`                                       |
| L191's build-status note rewritten, adding "the backend reads both until a catalogue release adopts it"                                                | **New requirement.** B1/B3's legacy branches are permanent, not migration scaffolding. New verification step 8b proves `v0.1.2` still syncs |
| Decision history's Open section gained "Move `ai-platform-infra`'s catalogue and the backend sync … **together**, and add `catalogue/schema/`"         | **New sequencing constraint**, now in A6: merge B, then tag, then move pins per environment                                                 |
| New `catalogue.md#availability` section carrying the direction in user-facing terms                                                                    | Added to the Authoritative source table. No new work — it agrees with design C                                                              |
| B04 rewritten: provider is the model maker, hosting routes are not providers, no approval `status`, `CatalogueSource` replaces the versioned seed      | **Phase I1/I2 as originally written are done.** Struck through                                                                              |
| `GET /v1/providers` removed from B04's Repositories row                                                                                                | Old I2 done                                                                                                                                 |
| AR03 advanced to v0.6.0: "Bedrock and direct provider APIs are hosting platforms behind API Management, never separate gateways or credential issuers" | **Old I3 was wrong** — it said leave `cloud-designs.json` alone. Upstream changed it deliberately. Struck through                           |
| `docs/mvp-portal-ui-api-scope.md` and `docs/stakeholder-source-evidence.md` deleted                                                                    | Old I4 removed — the file no longer exists                                                                                                  |
| B05 state row now names `ENABLED_ADAPTERS`; gap 4 names `MOCK_TIERS`                                                                                   | **New work, caused by this plan**: Phase R's rename makes B05 stale. Now I2                                                                 |
| New `.github/copilot-instructions.md` in that repo, with an eight-step "propagate, date and record" rule                                               | Phase I5 rewritten to follow it — it is stricter than the `design-pack.instructions.md` pointer cited before                                |
| Build status re-read at backend `0.24.0`, frontend `0.19.0`, infra `v0.1.2`                                                                            | Phase I is now entirely "report the built state once this ships", so it must be raised **after** R-G, not in parallel                       |

Net effect: Phase I shrank from five items to five _different_ items, all of them post-implementation
reporting rather than correcting a wrong model. Everything else gained two constraints and better
citations.

## Phase R implementation notes (9 October 2026)

**COMPLETE.** Backend only; R1-R9 done as written, backend 234/234 tests green, lint clean.

Differences from the plan text:

- **Model documents and catalogue offerings still carry `adapter`.** Phase R renames the
  _credential_ field and every config/code identifier, but `model.adapter` (read by
  `credential-issuer-registry.js`, `credential-service.js` and `catalogue-service.js`) stays until
  Phases B/C/D replace it with `gateway`. The credential write is therefore
  `gateway: model.adapter ?? null` for now.
- **README (R9)** had no env-table row naming `ENABLED_ADAPTERS`; only the prose section was
  renamed to "Gateways". It still says "the gateway (still the `adapter` field in the catalogue)"
  until Phase F2 rewrites it.
- **R6 index drop**: `mongodb.js` now creates `{ gateway: 1, status: 1 }` and drops
  `adapter_1_status_1` with the existing `dropIndexIfExists` helper.
- **R2 re-check**: `cdp-app-config/.../dev/ai-platform-backend-api.env` still does not set
  `ENABLED_ADAPTERS` (only a comment mentions "adapters"). Re-check before merging.
- Test wording that describes the _model_ field (fixtures such as `adapter: 'aws-bedrock'`) was
  left as is; it changes with Phase B/C.

## Phases B-H implementation notes (9 October 2026)

**COMPLETE** for B, C, D, E, F, G and H. Backend 242/242 tests green, lint clean; frontend model,
model-table and filter tests green, lint clean.

Differences from the plan text:

- **Phase A pushed and tagged (9 Oct 2026, by request).** `feature/catalogue-hosting-gateway-shape`
  (`ab8d215`, branched from `v0.1.2`) was pushed and `v0.2.0` tagged on that commit before the backend
  change merged, so A6's ordering was relaxed for the tag only. No `CATALOGUE_REF` has moved: keep
  every environment on `v0.1.2` until a backend that reads both shapes is deployed there. The branch
  was merged into `ai-platform-infra` `main` the same day as a merge commit (`e0068e4`), so the tag
  on `ab8d215` is an ancestor of `main` with identical content. Contents: `provider.schema.json`,
  a minimal `model.schema.json` (requires `slug`/`provider`/`offering`, rejects `cloud` and `adapter`
  without `additionalProperties: false`, since model files carry many other fields), the reshaped
  `openai.json`, `cloud`/`adapter` dropped from all 8 models, and a new `catalogue/README.md` recording
  A5.
- **`$schema` is stripped from providers on sync.** The new provider file carries `"$schema"`, which
  the github source passes through; a `$`-prefixed key in the providers `$set` would be rejected by
  Mongo. `syncCatalogue` drops it before the upsert (new test).
- **No legacy fallbacks (9 Oct, by direction).** `normalizeModel` takes `hosting`/`gateway` only from
  the offering; a model whose offering is unknown or missing is skipped, and an offering without
  `hosting.platform` and `gateway` skips the sync. `model-hosting.js` was removed: the issuer registry
  reads `model.gateway` (a model without one throws `gateway-not-enabled`).
- **D1** registered as `2026-10-08-models-hosting-gateway`, last in the registry, with a test that
  pins the order after `2026-10-08-credentials-gateway`.
- **E4-E6** use `aws-apigw` as the second gateway id. The two 2026-10-07 backfill tests keep their
  `aws-bedrock` data deliberately.
- **G4** added only `meta` to `format-label.js`. G2 originally reused `formatLabel('uk')`, which read
  "UK South"; after review a separate `formatDataZone` filter (`uk` is "UK", `eu` is "EU") is used
  for data zones and the region-only `uk` label was removed.
- **Verification steps 8 and 8b done offline (9 Oct 2026).** A temporary test (since deleted) fed the
  real `v0.1.2` and `v0.2.0` catalogue files, read with `git show` from the merged
  `ai-platform-infra`, through `syncCatalogue`: each release synced 8 models with no warnings and
  wrote the same nested `hosting`/`gateway` documents, with no flat `cloud`/`adapter` and no
  `$schema` on the provider. This is not the live GitHub source, so a run with
  `CATALOGUE_SOURCE=github` is still the user's.
- **Not yet done:** verification steps 5-7 against a real local Mongo; and the rollout in the
  "Phase I and rollout notes" below.
- **R7 changed after review (9 Oct 2026).** The credentials backfill is expand-only (copies
  `adapter` into `gateway`, keeps `adapter`), so a rolling deploy cannot leave documents from an
  older instance without either field. The models backfill still unsets `cloud`/`adapter`.

## Phase I and rollout notes (9 October 2026)

**COMPLETE.** Phase I is raised as `ai-platform-discovery-docs` pull request 15 (branch
`docs/gateway-catalogue-built-state`): `build-stories.md#status` (dated 9 October; B04, B05 and the
source sentence), `design-orchestration.md#catalogue-schema` and `#catalogue-flow`,
`design-repositories-pipelines.md`, a decision-history entry, a design pack plan delivered section
and `site.test.js`. By request it reports the hosting and gateway shape as built while the backend
and frontend pull requests are still open, and says so in the copy: the deployed backend `0.24.0`
reads only the flat shape and no pin has moved. `npm run lint` is clean and the site tests pass
except a Windows-only symlink test (EPERM); the browser tests were not run (no Playwright
browsers installed).

The dev pin is a draft `cdp-app-config` pull request (4820) from `feature/ai-platform-backend-catalogue-v0.2.0`:
`CATALOGUE_REF=v0.2.0`, `ENABLED_GATEWAYS=azure-apim` and `PROVISIONING_MODE=live`. The dev env file
no longer sets `ENABLED_ADAPTERS` (R2 re-check done). **Do not merge it until the new backend is
deployed to dev**, or the deployed `0.24.0` skips every model from `v0.2.0`.

Once the three code and docs pull requests are released, re-read `build-stories.md#status` for the
released versions.

## Keeping this plan current

Update the STATUS line at the top as each phase lands, and append a dated note recording what
actually happened versus what is written above — the same convention the route plans use. When this
work completes, add a dated pointer (not a copy) to the repository memory note on where plans live.

Before starting a phase, re-check `ai-platform-discovery-docs` for merged pull requests newer than
`7a60b71`. That repository's own instructions require every change to sweep for contradictions and
append to `docs/decision-history.md`, so its history is the fastest way to spot a direction that has
moved underneath this plan — as PR #14 did within a day of it being written.

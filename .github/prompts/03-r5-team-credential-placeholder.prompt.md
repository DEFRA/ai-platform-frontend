---
mode: agent
description: 'R5 - let a team finish the journey with a clearly labelled placeholder credential while Entra consent is outstanding.'
---

You are implementing **Phase R5** of
`docs/plans/in-progress/research-tier-infradev-plan.md`. Read that phase in full first, then this.

**Requires R6.** A team only reaches the credential step once its deployment reaches `active`, and
it cannot today. Do not start this before R6 is working.

## Repositories

`ai-platform-frontend` and `ai-platform-backend-api`.

## Why, and what is actually being mocked

Until Entra admin consent for `Application.ReadWrite.OwnedBy` lands there is no team app
registration to add a client secret to, so the Microsoft Graph call that Phase 5 B18 will make
cannot be made. `live` mode answers `501 gateway-not-enabled` from
`src/adapters/credential-issuer-registry.js`.

Mock **only that one step**. Everything else stays real: the same `CredentialIssuer` port, the same
`credential-service.js` path, the same one-credential-per-team-per-environment rule, the same vault
write, the same one-time reveal, the same pages. When B18 lands the adapter changes and nothing
else does.

Two facts already confirmed in the code - do not re-derive them:

- `src/adapters/credential-vault-registry.js` routes by the credential's `issuerKey`, **not** by
  provisioning mode. So a mock-issued team secret goes to the mock vault while research credentials
  go to the real Key Vault in the same run. No fake secret reaches the real vault.
- `src/adapters/mock-credential-vault.js` is an in-memory `Map`. A mocked secret does **not**
  survive a backend restart, so the one-time reveal finds nothing afterwards. Acceptable within a
  single demo run. If the demo must survive a restart, persist the mock vault - decide this
  deliberately, do not leave it to be discovered during the demo.

## What to build

Follow R5 items 1 to 5. The inset saying the credential is a placeholder, and why, is **one shared
component** used by the credential page, the `/manage` row and the wait page - not three copies of
the words. It says the credential is not yet usable; it does not hide it.

## Constraints

- Follow each repo's `.github/copilot-instructions.md`. Tests colocated as `<file>.test.js`.
- Use a GOV.UK component for the inset - do not hand-roll one.
- Content follows the Defra style guide: plain English, explain why, no jargon.
- Write the test that fails if a mocked secret is rendered without the inset. That test is what
  stops the placeholder silently outliving its reason.
- Before finishing: `npm run format`, then `format:check`, `lint` and `test` pass in both repos.

## Done when

A team journey completes and shows a credential with its key hint on `/manage`; the inset appears
wherever a mocked team secret does; a research credential issued in the same run still reaches the
real Key Vault.

Then update `docs/implemented-features.md` and add a dated note to the plan. Check that Phase 5
B18 in `docs/plans/in-progress/build-stories-delivery-plan.md` still names removing this
placeholder as part of that story.

---
mode: agent
description: 'B18 - replace the placeholder with a real team client secret, issued through Microsoft Graph against the team app registration.'
---

You are implementing **Phase 5, story B18** of
`docs/plans/in-progress/build-stories-delivery-plan.md`. Read that story in full first.

**Blocked until Entra admin consent for `Application.ReadWrite.OwnedBy` is granted on the backend
identity.** Do not start otherwise - there is nothing to call.

Also requires R6 item 6 of the research tier plan, which puts the team app registration's object id
on the team record.

## Repositories

`ai-platform-backend-api`, then `ai-platform-frontend` to remove the placeholder.

## The shape - two identities, only one of them the backend's

The backend keeps authenticating to Azure exactly as it does today: its own app registration with
federated credentials, built by `getArmCredential()` in `src/adapters/azure/azure-credential.js`.
**That does not change.** This story introduces no second way for the backend to sign in.

What changes is what it then calls. Research calls ARM to mint an API Management subscription key.
Team calls **Microsoft Graph** to add a client secret to the **team's own** registration - the one
Terraform created - then stores it in Key Vault and reveals it once, exactly as research does.

So this is one adapter behind the existing port, not a subsystem:

1. `graph-client.js` beside `arm-client.js` - same shape, same credential, different base URL and
   scope (`https://graph.microsoft.com/.default`). `getArmCredential()` is already scope-agnostic;
   rename it to something honest rather than copying it.
2. A Graph team credential issuer implementing `issue`, `rotate`, `revoke`, `suspend` and `renew`
   against the registration's `addPassword` and `removePassword`, returning the same
   `{externalId, secret, keyHint, expiresAt}` shape.
3. Replace the `'No gateway issues team OAuth credentials yet'` branch in
   `src/adapters/credential-issuer-registry.js` with the new issuer, keyed by tier. Persist its
   `issuerKey` so lifecycle operations route back to it. `MOCK_TIERS=team` stops being needed.
4. The registration's object id comes from the team record (R6 item 6) - **never** a Graph lookup
   by display name, which is guessable and ambiguous across environments.
5. Vault and reveal are unchanged: reuse `writeSecretToVault`, the `vaultState: 'unwritten'` retry
   in `reconcilePendingCredentials`, and `POST /v1/credentials/{id}/reveal`.
6. Fail closed where the registration does not exist - with `entra.teamRegistrations` false there
   is nothing to add a password to. Use a stable code the portal already maps.

## Do not forget

**Removing R5's placeholder is part of this story.** Delete the shared inset component and the test
that pins it, or the portal will keep telling people their working credential does not work.

## Constraints

- The new adapter must pass `credential-issuer-contract.js` **unchanged** - that suite is what
  proves Liskov substitution, and it is not to be weakened to fit a new adapter.
- Follow `.github/copilot-instructions.md`. Never log or persist a full secret; reveal only at
  creation and rotation.
- Enforce the credential rules in the story: secret lifetimes per environment, never fall back to
  a key after an OAuth denial.
- On Windows run tests with `$env:TZ='UTC'` then `npx vitest run`.
- Before finishing: `npm run format`, then `format:check`, `lint` and `test` pass in both repos.

## Done when

A client secret issued by the portal authenticates against the team's API; a suspended registration
is refused; no placeholder wording remains anywhere.

Then update `docs/implemented-features.md`, flip the Phase 5 status line, and open the separate
discovery-docs built-state pull request.

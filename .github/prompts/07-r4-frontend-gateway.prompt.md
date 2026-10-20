---
mode: agent
description: 'R4 - point the portal at the Infradev gateway per environment and stop the copy saying Sandbox.'
---

You are implementing **Phase R4** of
`docs/plans/implemented/02-research-tier.md`. Read that phase in full first.

**Requires R3.** The frontend should not describe an environment the backend cannot issue into.

## Repository

`ai-platform-frontend`.

## What to change

1. `src/config/config.js` currently has a single `gateway.baseUrl` defaulting to
   `https://deploytestdefra.azure-api.net` - the hand-built instance. Replace it with a
   per-environment base URL plus `RESEARCH_ENVIRONMENT`, so a code sample shows the right host.
   `gateway.researchApiId` stays `research`.
2. `src/server/common/helpers/gateway-request.js` takes the environment and builds the Infradev
   URL; the `code-examples` component snippets follow.
3. The copy stops saying Sandbox: `src/server/routes/connect/controller.js` ("A key that lasts 7
   days in Sandbox") and `src/server/routes/home/index.njk` ("in the Sandbox environment") read
   from `src/server/common/helpers/environment-names.js` and the configured research environment.
4. The research connect journey, `/models/{slug}` and `/manage/credentials/{id}` each say which
   environment the key works in.

## The thing not to change

The research path does not translate the model name, so the **endpoint shape people already use
stays correct**. The URL still carries the deployment name from the catalogue's `deploymentName`.
Only the host and the environment wording change. If you find yourself rewriting the request shape,
stop and re-read "The shape the design requires" in the plan.

## Constraints

- Follow `.github/copilot-instructions.md`. Never read `process.env` outside `src/config/config.js`.
- This frontend never calls the gateway - these values are cosmetic, for samples and wording.
- Content follows the Defra style guide: plain English, sentence case, "people" not "users".
- WCAG 2.2 AA. Use GOV.UK components; do not hand-roll a replacement for one.
- On Windows run tests with `$env:TZ='UTC'` and `$env:AWS_EMF_ENVIRONMENT='Local'` then
  `npx vitest run`.
- Before finishing: `npm run format`, then `format:check`, `lint` and `test` pass.

## Done when

A person copies the sample from the portal, runs it unedited, and gets a completion from Infradev.

Then update `docs/implemented-features.md` and add a dated note to the plan.

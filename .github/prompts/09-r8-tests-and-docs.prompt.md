---
mode: agent
description: 'R8 - journey tests, README values, implemented-features and the discovery-docs built-state PR.'
---

You are implementing **Phase R8** of
`ai-platform-frontend/docs/plans/remaining.md` (section 5, R8). Read that phase in
full first.

**Last.** It records what the other phases did, so it needs them done.

## Repositories

`ai-platform-journey-tests`, `ai-platform-backend-api`, `ai-platform-frontend`, then a **separate**
pull request in `ai-platform-discovery-docs`.

## What to do

1. A research-tier end-to-end journey test against Infradev, and a team-tier journey that asserts
   the placeholder wording from R5 - so the placeholder cannot silently outlive its reason.
2. The backend README's live-Azure section still names `SNDAIEEXPRGP1401`, `DEPLOYTESTDEFRA` and
   `kv-aip-sandbox-tenants`. Replace them with the Infradev values. Grep both repos for all three
   strings - the README is unlikely to be the only place.
3. Update `ai-platform-frontend/docs/plans/implemented/implemented-features.md`.
4. Then, in a **separate** discovery-docs pull request, update `build-stories.md`: B06 and B11 are
   currently recorded as proven "against hand-configured resources" and that is no longer true;
   B07, B09 and B16 also change. Follow that repo's propagate-date-and-record rules.
5. Security pass: no secret logged, `keyHint` everywhere but the two reveal points, the
   subscription scoped to the research API, Joi rejecting unknown keys, and the custom API
   Management role confirmed least privilege against what the adapter actually calls.

## Constraints

- Do not claim built state that the repositories do not support. Read them, cite the version and
  date; never infer built state from a plan.
- Keep every Markdown file short and consolidated. Update an existing section rather than
  appending a new one.
- Before finishing: `npm run format`, then `format:check`, `lint` and `test` pass in every
  repository touched.

## Done when

The journey tests pass against Infradev, and new research credentials use Infradev rather than the
hand-built resources. The replacements in step 2 apply only to guidance for new issuance: preserve
accurate historical records and the Sandbox configuration while credentials issued there still
need lifecycle operations.

Then move the R8 and research-tier items out of `docs/plans/remaining.md` into
`docs/plans/implemented/02-research-tier.md`, and update `docs/plans/README.md` and
`docs/plans/implemented/implemented-features.md` - per `.github/instructions/route-plans.instructions.md`.

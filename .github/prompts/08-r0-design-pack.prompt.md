---
mode: agent
description: 'R0 - update the design pack for the research tier shape, environment-awareness and the superseded public-hostname sentence.'
---

You are implementing **Phase R0** of
`ai-platform-frontend/docs/plans/in-progress/research-tier-infradev-plan.md`. Read that phase in
full first.

Independent of every other phase - a short documentation session, good to do while something else
is waiting on other people.

## Repository

`ai-platform-discovery-docs` only. This repository never changes the application repositories.

## Read before writing

`.github/copilot-instructions.md` in that repo. Its "Every change: propagate, date and record"
rules are strict and non-optional: sweep for drift, remove what is superseded, date every file you
touch, append to `docs/decision-history.md`, version structured records, pin it in the tests.

## What to change

Follow R0 items 1 to 7. The substantive ones:

- **Supersede** the sentence in `design-infrastructure.md` saying the Infradev research proof uses
  an existing API Management instance with a public hostname and no injection. It is now the
  platform's own instance. Public access remains a Phase 1 concession - that is a separate
  statement and stays.
- **Record the shape** in `design-orchestration.md` `#resource-model`: research is a platform-owned
  team file, with the same project, account-child deployments and generated API as a team,
  differing only in who authors it and that it names `subscription-key`. The model-access diagram
  already shows this; the prose must not imply a parallel stack.
- The model-access diagram is marked `Proposal - unimplemented`. **Move it to implemented only
  when R2 has applied, not now.** If its state lives in `src/data/cloud-designs.json`, follow the
  AR record rules: bump `version`, append a dated `history` entry, advance `reviewedOn`.

## Constraints

- Never rewrite a dated `decision-history.md` or `design-pack-plan.md` entry. Append.
- Add an `assertCopy` for the new direction and an `assert.doesNotMatch` for the superseded
  wording, so it cannot come back.
- Do not claim built state the application repositories do not support. The research project,
  deployments and API do not exist yet - everything about them says planned.

## Done when

`npm run lint`, `npm test` and `npm run check` pass, and no two pages disagree.

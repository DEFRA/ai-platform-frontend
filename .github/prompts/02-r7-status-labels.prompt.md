---
mode: agent
description: 'R7 - fix the status labels so "Setting up" stops meaning five different things and a page never disguises a stopped deployment.'
---

You are implementing **Phase R7** of
`docs/plans/in-progress/research-tier-infradev-plan.md`. Read that phase in full first, then this.

Do this after R6, or alongside it - both change the same pages.

## Repositories

`ai-platform-frontend` (most of it) and `ai-platform-backend-api` (the progress step labels).

## Why

One word currently means two unrelated things, and a silent fallback hides unknown states:

- `src/config/nunjucks/filters/format-label.js` maps a credential's `pending` to "Setting up".
- `src/server/common/helpers/deployment-status.js` returns "Setting up" as the **default** for any
  status it does not recognise - which silently covers `requested`, `pr-raised`, `merged`,
  `deploying`, `deployed` and `verified`, and would cover a new one nobody has mapped.
- `active` reads "Ready to view", which sounds like a document rather than working access.
- `src/server/routes/connect/team-request-view.js` heads every in-progress state with "Setting up
  your team client secret", including steps long before any secret exists.
- Backend `src/services/team-deployment-view.js` `PROGRESS_STEP_LABELS` ends with "Creating your
  client secret", which is not what happens while the credential is mocked.

## What to build

Follow R7 items 1 to 6. The one that matters most: map each GitOps status **explicitly** and make
the default an honest unknown, so a status the frontend has not been taught renders as unknown
rather than as reassuring progress. That is the same class of bug R6 fixes in the backend.

`/manage` actions ("Check progress", "Finish setting up", "Manage in {teamName}") must each appear
only in the state they actually describe - check `src/server/routes/manage/access-view.js` for
where each is chosen today.

## Constraints

- Follow each repo's `.github/copilot-instructions.md`. Tests colocated as `<file>.test.js`.
- Content follows the Defra style guide: plain English, "people" not "users", sentence case.
- Pin every string with a test - one per label map, plus the component and template tests. These
  are exactly the strings that drift silently.
- Never show raw GitOps status names to a person.
- On Windows run tests with `$env:TZ='UTC'` and `$env:AWS_EMF_ENVIRONMENT='Local'` then
  `npx vitest run` - `npm test` uses Unix env syntax.
- Before finishing: `npm run format`, then `format:check`, `lint` and `test` pass in both repos.

## Done when

No two different things share a label; an unmapped status renders as unknown rather than "Setting
up"; the wait page heading matches the step the person is actually on.

Then update `docs/implemented-features.md` and add a dated note to the plan.

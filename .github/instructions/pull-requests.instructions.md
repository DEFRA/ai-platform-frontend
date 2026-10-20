---
description: 'Use when preparing, opening or reviewing a pull request in this repo: what to run first, what a reviewer (human or Copilot) checks, and how to request Copilot review. Complements copilot-instructions.md, which is longer than Copilot code review reads.'
applyTo: '**'
---

# Pull requests and review

## Before opening

- Branch `<type>/<description>` from current `main`; conventional commits.
- Run `npm run format`, then `npm run format:check`, `npm run lint` and `npm test`; all pass. Never `--no-verify`.
- Behaviour change means a test change; a bug fix means a regression test that fails without the fix.
- Move the built item from `docs/plans/remaining.md` into `docs/plans/implemented/` and update `docs/plans/implemented/implemented-features.md` when a feature lands (see `route-plans.instructions.md`).
- Build to the current design only: no legacy paths or backwards-compatible fallbacks.

## What review checks (Copilot included)

- **Security.** No secret, PII or full credential in code, logs or tests. CSP is not relaxed (extend the Blankie allow-lists). CSRF (`@hapi/crumb`) stays on state-changing routes; session cookie settings are not loosened. Input validated with Joi.
- **Backend calls** go through `api-client.js` and map errors by the API's `code`, never by message.
- **Accessibility and design.** GOV.UK components used as-is, `.defra-*` for shared brand, `.app-*` for features; WCAG 2.2 AA; labels, alt text, keyboard access; plain English, "people" not "users", "Defra" not "DEFRA".
- **Style.** ES modules with named exports, function declarations, `#/*` imports across top-level `src/` folders, JSDoc on exports, exact-pinned dependencies, no discouraged libraries (lodash, moment, axios, frontend frameworks).
- **Tests** colocated as `<name>.test.js`; `vi.mock()` only for this repo's modules; coverage does not fall.

## Requesting review

1. Open the PR (draft while checks fail) and describe what changed, why, and how it was verified.
2. **Request Copilot review**: `gh pr edit <n> --add-reviewer "@copilot"`.
3. When Copilot's review lands, fix every comment or reply with the reason it does not apply, push, then resolve each thread (GraphQL `resolveReviewThread`). Re-request Copilot after a substantial push and repeat until nothing is unresolved.
4. Then request a human reviewer. Copilot is advisory and never replaces the required approval; the ruleset needs one approving review, resolved threads and approval of the last push.
5. Do not merge your own PR.

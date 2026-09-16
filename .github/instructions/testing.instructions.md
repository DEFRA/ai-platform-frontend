---
description: "Use when writing or updating Vitest test files (*.test.js) in this repo — controllers, plugins, helpers, or Nunjucks component templates. Covers colocation, naming, and Hapi server test setup conventions."
applyTo: "**/*.test.js"
---
# Testing Conventions

- Colocate test files next to the file under test (e.g. `controller.js` + `controller.test.js`), not in a separate `__tests__` folder.
- Use Vitest globals directly (`describe`, `test`, `expect`, `beforeAll`, `afterAll`) — no need to import them.
- For route/controller tests, boot a real Hapi server via `createServer()` from `#/server/server.js`, `initialize()` it in `beforeAll`, and `stop({ timeout: 0 })` in `afterAll`, then assert on `server.inject(...)` responses. See [src/server/routes/home/controller.test.js](../../src/server/routes/home/controller.test.js).
- Use `statusCodes` from `#/server/common/constants/status-codes.js` instead of magic numbers for HTTP status assertions.
- For Nunjucks component templates, render via the shared helper in [test-helpers/component-helpers.js](../../test-helpers/component-helpers.js) rather than calling `nunjucks` directly.
- Run the full suite with `npm test` (sets `AWS_EMF_ENVIRONMENT=Local TZ=UTC`); use `npm run test:watch` while iterating.

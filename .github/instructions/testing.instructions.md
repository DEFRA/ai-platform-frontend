---
description: 'Use when writing or updating Vitest test files (*.test.js) in this repo — controllers, plugins, helpers, or Nunjucks component templates. Covers colocation, naming, and Hapi server test setup conventions.'
applyTo: '**/*.test.js'
---

# Testing Conventions

- Colocate test files next to the file under test (e.g. `controller.js` + `controller.test.js`), not in a separate `__tests__` folder.
- Use Vitest globals directly (`describe`, `test`, `expect`, `beforeAll`, `afterAll`) — no need to import them.
- For route/controller tests, boot a real Hapi server via `createServer()` from `#/server/server.js`, `initialize()` it in `beforeAll`, and `stop({ timeout: 0 })` in `afterAll`, then assert on `server.inject(...)` responses. See [src/server/routes/home/controller.test.js](../../src/server/routes/home/controller.test.js).
- Use `statusCodes` from `#/server/common/constants/status-codes.js` instead of magic numbers for HTTP status assertions.
- For Nunjucks component templates, render via the shared helper in [test-helpers/component-helpers.js](../../test-helpers/component-helpers.js) rather than calling `nunjucks` directly.
- Run the full suite with `npm test` (sets `AWS_EMF_ENVIRONMENT=Local TZ=UTC`); use `npm run test:watch` while iterating.
- The `npm test` script's env vars use Unix syntax and fail in PowerShell — on Windows run `$env:AWS_EMF_ENVIRONMENT='Local'; $env:TZ='UTC'; npx vitest run --coverage` instead.
- Multi-step form journeys drive a real Hapi server via `server.inject` plus a manual cookie jar — see `test-helpers/oidc-session-helpers.js` (`signInViaOidc`, `mergeCookies`, `cookieHeader`) and `connect/controller.test.js` for the pattern. `vi.mock` the `openid-client` package and `#/server/common/helpers/oidc-client.js` per test file (Vitest hoists mocks per file, so every file needs its own mock block).
- `apiClient(request)` calls are mocked with `vitest-fetch-mock`'s `fetchMock.mockResponseOnce(...)`, queued FIFO in the exact order the controller issues `fetch()` calls — a controller making N parallel/sequential API calls needs N queued responses, in that order.
- `ApiError` (`api-client.js`) spreads the backend's full JSON error body onto the thrown error instance, not just `code`/`message`/`statusCode` — any extra field the backend attaches (e.g. `existingId` on a 409) is available directly on the caught error in controllers/tests.
- This colocation convention is a deliberate, documented divergence from the Defra AICE team's [testing standards](https://github.com/DEFRA/aice-team/blob/main/style-guides/javascript-testing.md) (which specify a separate `tests/` tree) — see the "Design and content standards" section in `copilot-instructions.md`. Follow AICE for anything this file doesn't already cover.

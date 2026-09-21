# Project Guidelines

CDP (Core Delivery Platform) Node.js frontend template — Hapi server + Nunjucks views + GOV.UK Frontend, built/bundled with Vite.

## Architecture

- `src/server/` — Hapi server, plugins, and routes. Each route lives in `src/server/routes/<name>/` with `index.js` (Hapi plugin registration), `controller.js`, `index.njk` (view), and a colocated `controller.test.js`. Routes are registered in `src/server/plugins/router.js`.
- `src/server/common/` — shared server helpers, constants, templates/layouts, and reusable Nunjucks components (`common/components/<name>/{macro,template}.njk` + `template.test.js`).
- `src/config/` — `convict`-based app config (`config.js`) and Nunjucks context/filters/globals.
- `src/client/` — front-end assets: `javascripts/application.js`, SCSS in `stylesheets/` (GOV.UK Frontend based).
- Import alias `#/*` maps to `src/*` (see `package.json` `imports`), e.g. `import { statusCodes } from '#/server/common/constants/status-codes.js'`.

## Build and Test

- Install: `npm install`
- Dev server: `npm run dev`
- Tests: `npm test` (Vitest, Node env vars `AWS_EMF_ENVIRONMENT=Local TZ=UTC`); watch mode: `npm run test:watch`
- Lint: `npm run lint` (JS via ESLint/neostandard + SCSS via Stylelint); format check: `npm run format:check`
- Full pre-commit check: `npm run git:pre-commit-hook`

## Conventions

- Tests are colocated next to the file under test (`controller.js` + `controller.test.js`), using Vitest globals (`describe`/`test`/`expect`) — see [src/server/routes/home/controller.test.js](../src/server/routes/home/controller.test.js).
- New pages/routes follow the existing `home` route shape: plugin `index.js` + `controller.js` + `index.njk`, registered in [src/server/plugins/router.js](../src/server/plugins/router.js).
- Reusable view components go in `src/server/common/components/<name>/` with a `macro.njk`, `template.njk`, and a `template.test.js` using the helpers in [test-helpers/component-helpers.js](../test-helpers/component-helpers.js).
- Use ES modules (`type: module`) and the `#/*` import alias instead of relative paths that cross top-level `src/` folders.
- Formatting/linting are enforced by Prettier, ESLint (neostandard) and Stylelint — don't hand-fix style issues that `npm run format` / `lint:js:fix` already covers.

## Code Quality and Design Principles

- Apply SOLID principles pragmatically to JS modules (not just classes):
  - **Single responsibility**: a controller handles one route's request/response mapping; a helper (`api-client.js`, `session.js`, `require-sign-in.js`) does one job. Don't fold business logic, API calls and view-model shaping into one function.
  - **Open/closed**: extend behaviour by adding new routes/helpers/components rather than editing shared helpers to special-case a new page.
  - **Liskov substitution**: anything implementing a shared shape (e.g. a controller's `{ get, post }` handlers) must be usable wherever that shape is expected, with no surprising side effects.
  - **Interface segregation**: keep helper modules focused and export only what callers need — don't force callers to depend on unrelated functions in the same file.
  - **Dependency inversion**: routes/controllers depend on the `apiClient` abstraction for backend calls, never on `fetch` or hardcoded URLs directly, so the transport can change without touching route code.
- Backend calls always go through `api-client.js` and treat `ai-platform-backend-api` as a RESTful JSON API: use the correct HTTP method for the operation (`GET` for reads, `POST` for creates/actions), send/receive JSON bodies, and map non-2xx responses via the API's `code` field rather than parsing messages.

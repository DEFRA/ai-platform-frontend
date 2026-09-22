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

## Design and content standards

- **AICE skills (installed)**: the Defra AICE team's Copilot CLI plugin `aice-javascript@defra-aice` (from the [DEFRA/aice-team](https://github.com/DEFRA/aice-team) marketplace) is installed and its skills are committed at project level under `.github/skills/` — `javascript-design-language`, `javascript-style-guide`, `javascript-testing-standards` and `javascript-review-standards`. These are live, invokable skills, not just reference links — consult them directly rather than re-deriving their rules from memory.
- **Look and feel**: build on GOV.UK Frontend, then layer Defra branding on top per `.github/skills/javascript-design-language/SKILL.md` (the authoritative, specific source — the general [Defra design guidance](https://digital.defra.gov.uk/design/branding) is the fallback for anything not covered there). Two brand greens, not one: `$defra-green` (`#008531`) for backgrounds — nav bar, hero, breadcrumb bar, footer border — and `$defra-green-aa` (`#00a33b`) for text/links on green (the service name link), since the primary green fails WCAG AA contrast for normal text on white. Body links stay GOV.UK blue (`#1d70b8`) always, never green. Defra header/logo/footer in place of the GOV.UK crown/header/footer; Helvetica/Arial font stacks rather than GOV.UK's "New Transport" font, since this service is not hosted on a `gov.uk` domain. Component classes: `.govuk-*` used as-is (never overridden directly), `.defra-*` for shared brand components (header, footer, nav, hero, tiles), `.app-*` for feature-specific ones.
- **Words**: follow the [Defra content style guide](https://digital.defra.gov.uk/content/defra-style-guide) for Defra-specific terms (it explicitly defers to the [GOV.UK style guide A to Z](https://www.gov.uk/guidance/style-guide/a-to-z) for everything else) — plain English, "people" rather than "users", sentence case for "Defra" (never "DEFRA").
- **AICE engineering standards**: this codebase must follow `.github/skills/javascript-style-guide/SKILL.md`, `javascript-testing-standards/SKILL.md` and `javascript-review-standards/SKILL.md`, in addition to this repo's own conventions above. Key points: ES modules with named exports only (no default exports), function declarations over arrow functions except for callbacks, exact-pinned dependency versions, and `vi.mock()`/`nock` only for modules or network calls this repo owns. **Known divergence**: the AICE testing standard specifies a dedicated `tests/` tree mirroring `src/`, while this repo colocates tests beside the file under test (see above) — treat the AICE guide as the default for anything not already an established convention here, and raise a decision with the team before moving existing tests wholesale.

## Code Quality and Design Principles

- Apply SOLID principles pragmatically to JS modules (not just classes):
  - **Single responsibility**: a controller handles one route's request/response mapping; a helper (`api-client.js`, `session.js`, `require-sign-in.js`) does one job. Don't fold business logic, API calls and view-model shaping into one function.
  - **Open/closed**: extend behaviour by adding new routes/helpers/components rather than editing shared helpers to special-case a new page.
  - **Liskov substitution**: anything implementing a shared shape (e.g. a controller's `{ get, post }` handlers) must be usable wherever that shape is expected, with no surprising side effects.
  - **Interface segregation**: keep helper modules focused and export only what callers need — don't force callers to depend on unrelated functions in the same file.
  - **Dependency inversion**: routes/controllers depend on the `apiClient` abstraction for backend calls, never on `fetch` or hardcoded URLs directly, so the transport can change without touching route code.
- Backend calls always go through `api-client.js` and treat `ai-platform-backend-api` as a RESTful JSON API: use the correct HTTP method for the operation (`GET` for reads, `POST` for creates/actions), send/receive JSON bodies, and map non-2xx responses via the API's `code` field rather than parsing messages.

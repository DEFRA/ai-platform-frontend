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
- Lint: `npm run lint` (JS via ESLint/neostandard + SCSS via Stylelint with `stylelint-config-gds`); format check: `npm run format:check`
- Full pre-commit check: `npm run git:pre-commit-hook`

## Conventions

- Tests are colocated next to the file under test (`controller.js` + `controller.test.js`), using Vitest globals (`describe`/`test`/`expect`) — see [src/server/routes/home/controller.test.js](../src/server/routes/home/controller.test.js).
- New pages/routes follow the existing `home` route shape: plugin `index.js` + `controller.js` + `index.njk`, registered in [src/server/plugins/router.js](../src/server/plugins/router.js).
- Reusable view components go in `src/server/common/components/<name>/` with a `macro.njk`, `template.njk`, and a `template.test.js` using the helpers in [test-helpers/component-helpers.js](../test-helpers/component-helpers.js).
- Use ES modules (`type: module`) and the `#/*` import alias instead of relative paths that cross top-level `src/` folders.
- Formatting/linting are enforced by Prettier, ESLint (neostandard) and Stylelint — don't hand-fix style issues that `npm run format` / `lint:js:fix` already covers.

## Design and content standards

- **AICE skills (installed)**: the Defra AICE team's Copilot CLI plugin `aice-javascript@defra-aice` (from the [DEFRA/aice-team](https://github.com/DEFRA/aice-team) marketplace) is installed and its skills are committed at project level under `.github/skills/` — `javascript-design-language`, `javascript-style-guide`, `javascript-testing-standards` and `javascript-review-standards`. These are live, invokable skills, not just reference links — consult them directly rather than re-deriving their rules from memory.
- **Keeping AICE skills current**: the copies under `.github/skills/` are a point-in-time snapshot, not a live link — `DEFRA/aice-team` updates do not propagate automatically. To refresh: `copilot plugin update aice-javascript@defra-aice`, then re-copy the changed skill folder(s) from `~/.copilot/installed-plugins/defra-aice/aice-javascript/skills/` over `.github/skills/` in this repo, and open a PR. Do this periodically (e.g. quarterly) or when AICE announces a style guide change.
- **Look and feel**: build on GOV.UK Frontend, then layer Defra branding on top per `.github/skills/javascript-design-language/SKILL.md` (the authoritative, specific source — the general [Defra design guidance](https://digital.defra.gov.uk/design/branding) is the fallback for anything not covered there). Two brand greens, not one: `$defra-green` (`#008531`) for backgrounds — nav bar, hero, breadcrumb bar, footer border — and `$defra-green-aa` (`#00a33b`) for text/links on green (the service name link), since the primary green fails WCAG AA contrast for normal text on white. Body links stay GOV.UK blue (`#1d70b8`) always, never green. Defra header/logo/footer in place of the GOV.UK crown/header/footer; Helvetica/Arial font stacks rather than GOV.UK's "New Transport" font, since this service is not hosted on a `gov.uk` domain. Component classes: `.govuk-*` used as-is (never overridden directly), `.defra-*` for shared brand components (header, footer, nav, hero, tiles), `.app-*` for feature-specific ones.
- **Words**: follow the [Defra content style guide](https://digital.defra.gov.uk/content/defra-style-guide) for Defra-specific terms (it explicitly defers to the [GOV.UK style guide A to Z](https://www.gov.uk/guidance/style-guide/a-to-z) for everything else) — plain English, "people" rather than "users", sentence case for "Defra" (never "DEFRA").
- **Accessibility**: all HTML must meet WCAG 2.2 Level AA — every interactive element keyboard accessible, every image has alt text, every form field has a label. GOV.UK Design System components/patterns satisfy this out of the box; don't hand-roll a replacement for one.
- **AICE engineering standards**: this codebase must follow `.github/skills/javascript-style-guide/SKILL.md`, `javascript-testing-standards/SKILL.md` and `javascript-review-standards/SKILL.md`, in addition to this repo's own conventions above. Key points: ES modules with named exports only (no default exports), function declarations over arrow functions except for callbacks, exact-pinned dependency versions, and `vi.mock()`/`nock` only for modules or network calls this repo owns. **Known divergence**: the AICE testing standard specifies a dedicated `tests/` tree mirroring `src/`, while this repo colocates tests beside the file under test (see above) — treat the AICE guide as the default for anything not already an established convention here, and raise a decision with the team before moving existing tests wholesale.

## Code Quality and Design Principles

- Apply SOLID principles pragmatically to JS modules (not just classes):
  - **Single responsibility**: a controller handles one route's request/response mapping; a helper (`api-client.js`, `session.js`, `require-sign-in.js`) does one job. Don't fold business logic, API calls and view-model shaping into one function.
  - **Open/closed**: extend behaviour by adding new routes/helpers/components rather than editing shared helpers to special-case a new page.
  - **Liskov substitution**: anything implementing a shared shape (e.g. a controller's `{ get, post }` handlers) must be usable wherever that shape is expected, with no surprising side effects.
  - **Interface segregation**: keep helper modules focused and export only what callers need — don't force callers to depend on unrelated functions in the same file.
  - **Dependency inversion**: routes/controllers depend on the `apiClient` abstraction for backend calls, never on `fetch` or hardcoded URLs directly, so the transport can change without touching route code.
- Backend calls always go through `api-client.js` and treat `ai-platform-backend-api` as a RESTful JSON API: use the correct HTTP method for the operation (`GET` for reads, `POST` for creates/actions), send/receive JSON bodies, and map non-2xx responses via the API's `code` field rather than parsing messages.

## Naming conventions

- **Route directories and JS files**: `kebab-case` (e.g. `src/server/routes/sign-in/`, `oidc-client.js`, `session-cache.js`) — not camelCase.
- **Routes (URL paths)**: lowercase with hyphens (e.g. `/sign-in`, `/sign-out`).
- **Environment variables**: `UPPER_SNAKE_CASE` (e.g. `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`).
- **Config keys**: `lowerCamelCase`, read via `config.get('session.cookie.secure')` style dotted paths — never `process.env` directly outside `src/config/config.js`.
- **CSS classes**: `.govuk-*` used as-is, `.defra-*` for shared brand components, `.app-*` for feature-specific ones (see Design and content standards below).
- **Test files**: `<name>.test.js` colocated next to the file under test.

## Branching and version control

- `main` is always shippable — it must build, pass all tests, and be deployable at any time.
- All work happens on branches, never directly on `main`. Follow trunk-based development with short-lived feature branches and pull requests.
- Branch naming: `<type>/<brief-description>` (`feature/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`).
- Commit messages use conventional format: `type: short description` (`feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`).
- Open a pull request and get it reviewed before merging to `main`.

## Quality gates

CI (`.github/workflows/check-pull-request.yml`) currently runs on every PR: `npm run security-audit`, `npm ci`, `npm run build:frontend`, `npm run format:check`, `npm run lint`, `npm test` (coverage), and a Docker image build test. All of these must pass before merging.

- SonarCloud is configured (`sonar-project.properties`) but the scan step is **currently commented out** in `check-pull-request.yml` and `publish.yml` — it is not yet an active CI gate. Don't assume a Sonar quality gate is blocking merges until that step is uncommented.
- Follow the Defra tiered coverage targets as the aspiration for any code you touch: ≥90% global, ≥95% for core business logic, 100% for error handling and security-critical paths — and never let coverage decrease from the current baseline.
- At least one approving code review from another developer before merging.

## Allowed / discouraged dependencies

This repo already complies with Defra's dependency guidance — keep it that way when adding new packages:

- Hapi, not Express/Fastify/Koa.
- Standalone `joi`, not the deprecated `@hapi/joi`.
- Native `fetch`/`undici`, not `request` or `axios`.
- `neostandard`, not bare `eslint`/`prettier`/`standard` configs.
- No TypeScript without an approved exception — vanilla JS with JSDoc.
- No `lodash` or `moment` — use native JS methods and `date-fns` (already a dependency) instead.
- No frontend JavaScript frameworks (React, Vue, Angular) — server-rendered Nunjucks only, progressive enhancement via `src/client/javascripts/application.js`.
- New dependencies must be widely used, actively maintained, and compatible with the current Node.js LTS.

## Security

- Follow OWASP Secure Coding Practices.
- Never log, persist, or expose PII (names, addresses, emails, phone numbers) or secrets — logging is structured JSON via `hapi-pino` + `@elastic/ecs-pino-format`, and this rule applies to every log line, including error/debug levels.
- Validate and sanitise all user input with `joi`.
- CSP is enforced via Blankie ([content-security-policy.js](../src/server/plugins/content-security-policy.js)) — no `unsafe-inline`/`unsafe-eval`; extend the allow-lists there rather than relaxing the policy globally.
- CSRF protection is enforced via `@hapi/crumb` on state-changing routes.
- Session cookies ([session-cache.js](../src/server/plugins/session-cache.js)) use `@hapi/yar` with `isSecure` from config and `isSameSite: 'Lax'` — don't loosen these without understanding the OIDC redirect flow that requires `Lax`.
- Sign-in is Entra ID (Azure AD) via `openid-client` ([oidc-client.js](../src/server/common/helpers/oidc-client.js), [auth/controller.js](../src/server/routes/auth/controller.js)) — do not build a bespoke sign-in flow or add another identity provider without a documented decision.
- Only use approved MCP servers (see [Defra MCP guidance](https://defra.github.io/defra-ai-sdlc/pages/appendix/defra-mcp-guidance/)) — do not enable community or self-built MCP servers.

## Documentation

- Write JSDoc comments for exported functions.
- Keep the README up to date with setup, run, and environment variable changes.
- Document breaking changes in PR descriptions.

## How Copilot should respond

- Follow conventions already in the codebase — check existing patterns first.
- Prefer modifying existing files over creating new ones when the change fits naturally.
- Provide minimal diffs touching only the necessary files; do not refactor unrelated code.
- Always include or update tests for changed behaviour.
- For any form or reusable UI pattern, propose or extend a Nunjucks macro/component using GOV.UK components.
- Keep solutions DRY: before adding new utilities, search `src/server/common/` and existing routes for similar code.
- If a request conflicts with these instructions, or would use a discouraged library, skip tests, hardcode a secret, or break a quality gate — flag it explicitly and do not proceed silently.

## Licence

All code is published under the [Open Government Licence v3](../LICENCE) unless an exception is approved.
